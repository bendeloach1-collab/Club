import Stripe from "stripe";
import { AppError } from "@/lib/errors";
import type { NormalizedPaymentEvent } from "./types";

/**
 * Signature verification and event normalisation shared by the live Stripe adapter and the
 * sandbox adapter (which emits Stripe-shaped events signed with its own secret), so the
 * webhook path exercised in development is the one that runs in production.
 */
export function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string): Stripe.Event {
  if (!signatureHeader) throw new AppError("invalid_signature", "Missing webhook signature.", 400);
  try {
    return Stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch {
    throw new AppError("invalid_signature", "Webhook signature verification failed.", 400);
  }
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as Obj).id === "string" ? ((v as Obj).id as string) : null);

export function normalizeStripeEvent(event: Stripe.Event): NormalizedPaymentEvent {
  const obj = event.data.object as unknown as Obj;
  const meta = (obj.metadata ?? {}) as Obj;
  const base = { eventId: event.id, type: event.type as string, raw: event };
  const fromSession = () => ({
    ...base,
    checkoutId: str(obj.id),
    paymentId: str(meta.aac_payment_id) ?? str(obj.client_reference_id),
    providerPaymentId: str(obj.payment_intent),
  });
  const fromIntent = () => ({ ...base, providerPaymentId: str(obj.id), paymentId: str(meta.aac_payment_id) });

  switch (event.type) {
    case "checkout.session.completed":
      // Delayed methods complete the session before funds settle: payment_status stays "unpaid".
      return { ...fromSession(), update: obj.payment_status === "paid" ? { kind: "succeeded" } : { kind: "processing" } };
    case "checkout.session.async_payment_succeeded":
      return { ...fromSession(), update: { kind: "succeeded" } };
    case "checkout.session.async_payment_failed":
      return { ...fromSession(), update: { kind: "failed", reason: "The payment method was declined after submission." } };
    case "checkout.session.expired":
      return { ...fromSession(), update: { kind: "canceled" } };
    case "payment_intent.requires_action":
      return { ...fromIntent(), update: { kind: "requires_action" } };
    case "payment_intent.processing":
      return { ...fromIntent(), update: { kind: "processing" } };
    case "payment_intent.payment_failed": {
      const err = (obj.last_payment_error ?? {}) as Obj;
      // The hosted checkout stays open after a declined attempt, so this is not terminal.
      return { ...fromIntent(), update: { kind: "attempt_failed", reason: str(err.code) ?? "declined" } };
    }
    case "charge.refunded":
      return {
        ...base,
        providerPaymentId: str(obj.payment_intent),
        paymentId: str(meta.aac_payment_id),
        update: { kind: "refunded", refundedCentsTotal: Number(obj.amount_refunded ?? 0) },
      };
    default:
      return { ...base, update: { kind: "ignored" } };
  }
}
