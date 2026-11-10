import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, billingAccounts, households, memberships, payments, user, webhookEvents } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { audit } from "@/modules/audit/audit";
import { assertCan, type Actor } from "@/modules/identity/actor";
import { getPaymentProvider } from "./providers";
import { retryWebhookEvent } from "./webhooks";

export async function listPayments(actor: Actor, opts: { page?: number; pageSize?: number; status?: string } = {}) {
  assertCan(actor, "billing.view");
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const rows = await db
    .select({ p: payments, householdId: households.id, householdName: households.name })
    .from(payments)
    .innerJoin(billingAccounts, eq(billingAccounts.id, payments.billingAccountId))
    .innerJoin(households, eq(households.id, billingAccounts.householdId))
    .where(opts.status ? eq(payments.status, opts.status as never) : undefined)
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

/** Webhook events needing attention first, for failed-event review. */
export async function listWebhookEvents(actor: Actor, limit = 30) {
  assertCan(actor, "billing.view");
  return db
    .select({ id: webhookEvents.id, provider: webhookEvents.provider, eventId: webhookEvents.eventId, type: webhookEvents.type, status: webhookEvents.status, error: webhookEvents.error, attempts: webhookEvents.attempts, receivedAt: webhookEvents.receivedAt })
    .from(webhookEvents)
    .orderBy(sql`case ${webhookEvents.status} when 'failed' then 0 when 'received' then 1 else 2 end`, desc(webhookEvents.receivedAt))
    .limit(limit);
}

export async function retryFailedWebhook(actor: Actor, id: string) {
  assertCan(actor, "billing.manage");
  const ok = await retryWebhookEvent(getPaymentProvider(), id);
  await audit(db, { actorUserId: actor.userId, action: "webhook.retried", entityType: "webhook_event", entityId: id, data: { ok } });
  return ok;
}

export const accountSettingsSchema = z.object({
  householdId: z.string().uuid(),
  chargeEnabled: z.boolean(),
  creditLimitCents: z.number().int().min(0).max(100_000_00),
  status: z.enum(["active", "suspended"]),
});

/** Finance controls for "Charge to Club Account": enablement, limit and overdue suspension. */
export async function updateAccountSettings(actor: Actor, raw: z.input<typeof accountSettingsSchema>) {
  assertCan(actor, "billing.manage");
  const input = accountSettingsSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [acct] = await tx.update(billingAccounts).set({ chargeEnabled: input.chargeEnabled, creditLimitCents: input.creditLimitCents, status: input.status, updatedAt: new Date() }).where(eq(billingAccounts.householdId, input.householdId)).returning();
    if (!acct) throw new NotFoundError("Billing account");
    await audit(tx, { actorUserId: actor.userId, action: "billing.account_settings_updated", entityType: "billing_account", entityId: acct.id, householdId: input.householdId, data: { chargeEnabled: input.chargeEnabled, creditLimitCents: input.creditLimitCents, status: input.status } });
  });
}

export async function listAudit(actor: Actor, opts: { page?: number; entityType?: string } = {}) {
  assertCan(actor, "audit.view");
  const pageSize = 50;
  const page = Math.max(opts.page ?? 1, 1);
  const rows = await db
    .select({ a: auditLog, actorName: user.name })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorUserId))
    .where(opts.entityType ? eq(auditLog.entityType, opts.entityType) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

export async function operationsSummary(actor: Actor) {
  assertCan(actor, "reports.view");
  const [membershipCounts, paymentTotals, failedWebhooks] = await Promise.all([
    db.select({ status: memberships.status, count: sql<number>`count(*)::int` }).from(memberships).groupBy(memberships.status),
    db.select({ status: payments.status, count: sql<number>`count(*)::int`, totalCents: sql<number>`coalesce(sum(${payments.amountCents}),0)::int`, refundedCents: sql<number>`coalesce(sum(${payments.refundedCents}),0)::int` }).from(payments).groupBy(payments.status),
    db.select({ n: sql<number>`count(*)::int` }).from(webhookEvents).where(inArray(webhookEvents.status, ["failed"])),
  ]);
  return { membershipCounts, paymentTotals, failedWebhooks: failedWebhooks[0]?.n ?? 0 };
}
