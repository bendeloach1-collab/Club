import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { billingAccounts, payments, type PaymentLineItem, type PaymentStatus } from "@/db/schema";
import { env } from "@/lib/env";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { log, reportError } from "@/lib/log";
import { audit } from "@/modules/audit/audit";
import { assertCan, type Actor } from "@/modules/identity/actor";
import { fulfillPayment, releasePayment, onPaymentProcessing } from "./fulfillment";
import { postEntry } from "./ledger";
import { getPaymentProvider } from "./providers";
import type { NormalizedPaymentEvent, ProviderPaymentState } from "./providers/types";

export type Payment = typeof payments.$inferSelect;

export type CreatePaymentInput = {
  billingAccountId: string;
  purpose: Payment["purpose"];
  currency: string;
  lineItems: PaymentLineItem[];
  idempotencyKey: string;
  createdByUserId?: string | null;
};

/** Create the internal payment record. The same idempotency key always yields the same payment. */
export async function createPayment(tx: DbOrTx, input: CreatePaymentInput): Promise<Payment> {
  const amountCents = input.lineItems.reduce((s, li) => s + li.amountCents, 0);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new ValidationError("Payment amount must be positive.");
  const [row] = await tx
    .insert(payments)
    .values({
      billingAccountId: input.billingAccountId,
      purpose: input.purpose,
      amountCents,
      currency: input.currency.toLowerCase(),
      provider: getPaymentProvider().name,
      lineItems: input.lineItems,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: input.createdByUserId ?? null,
    })
    .onConflictDoNothing({ target: payments.idempotencyKey })
    .returning();
  if (row) return row;
  const [existing] = await tx.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey));
  if (!existing) throw new Error("payment idempotency lookup failed");
  if (existing.billingAccountId !== input.billingAccountId) throw new ConflictError("Idempotency key was reused for a different request.");
  return existing;
}

/**
 * Open (or resume) the provider-hosted checkout for a pending payment. Safe to retry:
 * the provider call carries the payment's idempotency key, so one payment has one checkout.
 */
export async function startCheckout(
  paymentId: string,
  opts: { successPath: string; cancelPath: string; customerEmail?: string | null; savePaymentMethod?: boolean },
): Promise<{ payment: Payment; url: string | null }> {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw new NotFoundError("Payment");
  if (p.status !== "pending") return { payment: p, url: null };
  if (p.checkoutUrl) return { payment: p, url: p.checkoutUrl };
  const [acct] = await db.select().from(billingAccounts).where(eq(billingAccounts.id, p.billingAccountId));
  const provider = getPaymentProvider();
  const res = await provider.createCheckout({
    paymentId: p.id,
    amountCents: p.amountCents,
    currency: p.currency,
    description: p.lineItems.map((l) => l.description).join(", ").slice(0, 200) || "Athens Athletic Club",
    customerEmail: opts.customerEmail,
    providerCustomerId: provider.name === "stripe" ? acct?.providerCustomerId : null,
    successUrl: `${env.appUrl}${opts.successPath}`,
    cancelUrl: `${env.appUrl}${opts.cancelPath}`,
    idempotencyKey: p.idempotencyKey,
    savePaymentMethod: opts.savePaymentMethod,
  });
  const [updated] = await db
    .update(payments)
    .set({ providerCheckoutId: res.checkoutId, providerPaymentId: res.providerPaymentId ?? null, checkoutUrl: res.url, updatedAt: new Date() })
    .where(eq(payments.id, p.id))
    .returning();
  return { payment: updated!, url: res.url };
}

const SETTLED: PaymentStatus[] = ["succeeded", "partially_refunded", "refunded"];

/**
 * The payment state machine. Every provider fact (webhook, return-page sync, reconciliation)
 * funnels through here under a row lock, so duplicated or reordered events converge on one
 * consistent result and each ledger posting happens exactly once.
 */
export async function applyPaymentUpdate(
  paymentId: string,
  update: NormalizedPaymentEvent["update"],
  ids: { providerPaymentId?: string | null } = {},
  source = "webhook",
): Promise<{ changed: boolean; status: PaymentStatus }> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) throw new NotFoundError("Payment");
    let status = p.status;
    let changed = false;
    const set = async (values: Partial<typeof payments.$inferInsert>) => {
      await tx.update(payments).set({ ...values, updatedAt: new Date() }).where(eq(payments.id, p.id));
      changed = true;
    };
    if (ids.providerPaymentId && !p.providerPaymentId) await set({ providerPaymentId: ids.providerPaymentId });

    const settle = async () => {
      if (SETTLED.includes(status)) return;
      status = "succeeded";
      await set({ status, settledAt: new Date(), failureReason: null });
      await postEntry(tx, {
        billingAccountId: p.billingAccountId,
        entryType: "payment",
        amountCents: -p.amountCents,
        currency: p.currency,
        description: `Payment received (${p.provider === "sandbox" ? "SANDBOX" : "card/bank"})`,
        category: "payment",
        paymentId: p.id,
        idempotencyKey: `payment:${p.id}`,
      });
      const fulfilled = await fulfillPayment(tx, p);
      await audit(tx, {
        actorUserId: null,
        action: fulfilled ? "payment.succeeded" : "payment.succeeded_unfulfilled",
        entityType: "payment",
        entityId: p.id,
        data: { source, purpose: p.purpose, amountCents: p.amountCents },
      });
    };

    switch (update.kind) {
      case "succeeded":
        // Funds have moved, so this is recorded from any prior state (including failed/canceled).
        await settle();
        break;
      case "processing":
        if (status === "pending" || status === "requires_action") {
          status = "processing";
          await set({ status });
          await onPaymentProcessing(tx, p);
        }
        break;
      case "requires_action":
        if (status === "pending") {
          status = "requires_action";
          await set({ status });
        }
        break;
      case "attempt_failed":
        if (status === "pending" || status === "requires_action") await set({ failureReason: update.reason });
        break;
      case "failed":
      case "canceled":
        if (status === "pending" || status === "requires_action" || (status === "processing" && update.kind === "failed")) {
          status = update.kind;
          await set({ status, failureReason: update.kind === "failed" ? update.reason : p.failureReason });
          await releasePayment(tx, p, update.kind);
          await audit(tx, { actorUserId: null, action: `payment.${update.kind}`, entityType: "payment", entityId: p.id, data: { source } });
        }
        break;
      case "refunded": {
        // A refund implies the charge settled, even if that event has not arrived yet.
        await settle();
        const total = Math.min(update.refundedCentsTotal, p.amountCents);
        const delta = total - p.refundedCents;
        if (delta > 0) {
          await postEntry(tx, {
            billingAccountId: p.billingAccountId,
            entryType: "refund",
            amountCents: delta,
            currency: p.currency,
            description: "Refund to original payment method",
            category: "refund",
            paymentId: p.id,
            idempotencyKey: `refund:${p.id}:${total}`,
          });
          status = total >= p.amountCents ? "refunded" : "partially_refunded";
          await set({ refundedCents: total, status });
          await audit(tx, { actorUserId: null, action: "payment.refunded", entityType: "payment", entityId: p.id, data: { source, refundedCentsTotal: total } });
        }
        break;
      }
      case "ignored":
        break;
    }
    return { changed, status };
  });
}

function stateToUpdates(s: ProviderPaymentState): NormalizedPaymentEvent["update"][] {
  switch (s.status) {
    case "succeeded":
      return s.refundedCents ? [{ kind: "succeeded" }, { kind: "refunded", refundedCentsTotal: s.refundedCents }] : [{ kind: "succeeded" }];
    case "processing":
      return [{ kind: "processing" }];
    case "requires_action":
      return [{ kind: "requires_action" }];
    case "failed":
      return [{ kind: "failed", reason: s.failureReason ?? null }];
    case "canceled":
      return [{ kind: "canceled" }];
    default:
      return [];
  }
}

/**
 * Pull the trusted provider state for a payment and apply it. Used when the customer returns
 * from checkout (a browser redirect alone proves nothing) and by periodic reconciliation.
 */
export async function syncPaymentFromProvider(paymentId: string): Promise<Payment> {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw new NotFoundError("Payment");
  if (p.providerCheckoutId && p.provider === getPaymentProvider().name) {
    const state = await getPaymentProvider().retrieveCheckout(p.providerCheckoutId);
    for (const u of stateToUpdates(state)) await applyPaymentUpdate(p.id, u, { providerPaymentId: state.providerPaymentId }, "sync");
  }
  const [fresh] = await db.select().from(payments).where(eq(payments.id, paymentId));
  return fresh!;
}

/** Staff refund to the original payment method, optionally crediting the related charge. */
export async function refundPayment(actor: Actor, paymentId: string, amountCents: number, reason: string, opts: { creditCharge?: boolean } = {}) {
  assertCan(actor, "billing.manage");
  return refundPaymentInternal(paymentId, amountCents, reason, { ...opts, actorUserId: actor.userId });
}

export async function refundPaymentInternal(
  paymentId: string,
  amountCents: number,
  reason: string,
  opts: { creditCharge?: boolean; actorUserId?: string | null } = {},
) {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw new NotFoundError("Payment");
  if (p.status !== "succeeded" && p.status !== "partially_refunded") throw new ConflictError("Only settled payments can be refunded.");
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > p.amountCents - p.refundedCents) {
    throw new ValidationError("Refund amount exceeds the refundable balance.");
  }
  if (!p.providerPaymentId) throw new ConflictError("This payment has no processor reference to refund.");
  // Keyed on the refunded total so a double-submit maps to the same provider refund.
  const key = `${p.id}:${p.refundedCents}:${amountCents}`;
  await getPaymentProvider().refund({ providerPaymentId: p.providerPaymentId, amountCents, idempotencyKey: key });
  await db.transaction(async (tx) => {
    if (opts.creditCharge) {
      await postEntry(tx, {
        billingAccountId: p.billingAccountId,
        entryType: "credit",
        amountCents: -amountCents,
        currency: p.currency,
        description: `Credit: ${reason}`,
        category: "refund_credit",
        paymentId: p.id,
        idempotencyKey: `refund-credit:${key}`,
        createdByUserId: opts.actorUserId ?? null,
      });
    }
    await audit(tx, { actorUserId: opts.actorUserId ?? null, action: "payment.refund_requested", entityType: "payment", entityId: p.id, data: { amountCents, reason } });
  });
  log.info("payment.refund_requested", { paymentId: p.id, amountCents });
}

/**
 * Periodic reconciliation: re-check payments that have not reached a final state and
 * abandon checkouts that were never opened. Each payment is isolated so one provider
 * failure does not block the rest.
 */
export async function reconcileOpenPayments(now = new Date()) {
  const cutoff = new Date(now.getTime() - 2 * 60 * 1000);
  const open = await db
    .select({ id: payments.id, checkout: payments.providerCheckoutId, createdAt: payments.createdAt })
    .from(payments)
    .where(and(inArray(payments.status, ["pending", "requires_action", "processing"]), lt(payments.updatedAt, cutoff)))
    .limit(200);
  let synced = 0;
  let abandoned = 0;
  let errors = 0;
  for (const p of open) {
    try {
      if (p.checkout) {
        await syncPaymentFromProvider(p.id);
        synced++;
      } else if (now.getTime() - p.createdAt.getTime() > 60 * 60 * 1000) {
        await applyPaymentUpdate(p.id, { kind: "canceled" }, {}, "reconcile");
        abandoned++;
      }
    } catch (e) {
      errors++;
      reportError("reconcile.payment_failed", e, { paymentId: p.id });
    }
  }
  return { checked: open.length, synced, abandoned, errors };
}

export async function paymentTotalsByStatus(tx: DbOrTx = db) {
  return tx
    .select({ status: payments.status, count: sql<number>`count(*)::int`, totalCents: sql<number>`coalesce(sum(${payments.amountCents}),0)::int` })
    .from(payments)
    .groupBy(payments.status);
}
