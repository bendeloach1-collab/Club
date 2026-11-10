import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { payments, webhookEvents } from "@/db/schema";
import { reportError } from "@/lib/log";
import { applyPaymentUpdate } from "./payments";
import type { NormalizedPaymentEvent, PaymentProvider } from "./providers/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findPaymentId(ev: NormalizedPaymentEvent): Promise<string | null> {
  const conds = [];
  if (ev.paymentId && UUID.test(ev.paymentId)) conds.push(eq(payments.id, ev.paymentId));
  if (ev.checkoutId) conds.push(eq(payments.providerCheckoutId, ev.checkoutId));
  if (ev.providerPaymentId) conds.push(eq(payments.providerPaymentId, ev.providerPaymentId));
  if (conds.length === 0) return null;
  const [p] = await db.select({ id: payments.id }).from(payments).where(or(...conds));
  return p?.id ?? null;
}

export type WebhookResult = { outcome: "processed" | "ignored" | "duplicate"; eventId: string };

/**
 * Entry point for processor webhooks.
 * 1. Verify the signature over the raw body (throws → 400, nothing stored).
 * 2. Record the event once, keyed by (provider, event id); finished duplicates are acknowledged.
 * 3. Apply it through the payment state machine, which tolerates reordering.
 * A processing failure is stored for review and rethrown so the provider retries.
 */
export async function handlePaymentWebhook(provider: PaymentProvider, rawBody: string, signature: string | null): Promise<WebhookResult> {
  const ev = provider.parseWebhook(rawBody, signature);
  const [inserted] = await db
    .insert(webhookEvents)
    .values({ provider: provider.name, eventId: ev.eventId, type: ev.type, payload: ev.raw as object })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  const where = and(eq(webhookEvents.provider, provider.name), eq(webhookEvents.eventId, ev.eventId));
  if (!inserted) {
    const [existing] = await db.select().from(webhookEvents).where(where);
    if (existing && (existing.status === "processed" || existing.status === "ignored")) return { outcome: "duplicate", eventId: ev.eventId };
  }
  try {
    let outcome: "processed" | "ignored" = "ignored";
    let note: string | null = null;
    if (ev.update.kind !== "ignored") {
      const paymentId = await findPaymentId(ev);
      if (paymentId) {
        await applyPaymentUpdate(paymentId, ev.update, { providerPaymentId: ev.providerPaymentId });
        outcome = "processed";
      } else {
        note = "No matching AAC payment.";
      }
    }
    await db.update(webhookEvents).set({ status: outcome, error: note, processedAt: new Date() }).where(where);
    return { outcome, eventId: ev.eventId };
  } catch (e) {
    reportError("webhook.processing_failed", e, { eventId: ev.eventId, type: ev.type });
    const [cur] = await db.select({ attempts: webhookEvents.attempts }).from(webhookEvents).where(where);
    await db
      .update(webhookEvents)
      .set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "unknown error", attempts: (cur?.attempts ?? 0) + 1 })
      .where(where);
    throw e;
  }
}

/** Staff-triggered retry of a stored failed event (the stored payload was signature-verified on receipt). */
export async function retryWebhookEvent(provider: PaymentProvider, eventRowId: string) {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventRowId));
  if (!row || row.status !== "failed") return false;
  const { normalizeStripeEvent } = await import("./providers/stripe-events");
  const ev = normalizeStripeEvent(row.payload as never);
  const paymentId = await findPaymentId(ev);
  if (paymentId && ev.update.kind !== "ignored") await applyPaymentUpdate(paymentId, ev.update, { providerPaymentId: ev.providerPaymentId }, "retry");
  await db.update(webhookEvents).set({ status: paymentId ? "processed" : "ignored", error: null, processedAt: new Date() }).where(eq(webhookEvents.id, row.id));
  void provider;
  return true;
}
