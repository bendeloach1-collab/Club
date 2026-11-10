import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { sandboxCheckouts } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError, NotFoundError } from "@/lib/errors";
import { normalizeStripeEvent, verifyStripeSignature } from "./stripe-events";
import type { CheckoutRequest, CheckoutResult, PaymentProvider, ProviderPaymentState } from "./types";

/**
 * SANDBOX payment processor: a simulated provider for development, demos and tests.
 * No money moves. It emits Stripe-shaped webhook events signed with SANDBOX_WEBHOOK_SECRET
 * and delivered through the same verification + processing path as live Stripe events.
 * It is NOT a production payment integration.
 */
export type SandboxOutcome = "success" | "decline" | "delayed" | "delayed_success" | "delayed_failure" | "cancel";

export class SandboxProvider implements PaymentProvider {
  readonly name = "sandbox" as const;
  readonly isSandbox = true;

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    // Mirror provider idempotency: the same key returns the same checkout.
    const id = `cs_sandbox_${req.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(-40)}`;
    const paymentIntentId = `pi_sandbox_${randomUUID().replace(/-/g, "")}`;
    await db
      .insert(sandboxCheckouts)
      .values({
        id,
        paymentIntentId,
        paymentId: req.paymentId,
        amountCents: req.amountCents,
        currency: req.currency,
        description: req.description,
        successUrl: req.successUrl,
        cancelUrl: req.cancelUrl,
      })
      .onConflictDoNothing();
    const [row] = await db.select().from(sandboxCheckouts).where(eq(sandboxCheckouts.id, id));
    return { checkoutId: id, url: `${env.appUrl}/sandbox/checkout/${id}`, providerPaymentId: row!.paymentIntentId };
  }

  async retrieveCheckout(checkoutId: string): Promise<ProviderPaymentState> {
    const [c] = await db.select().from(sandboxCheckouts).where(eq(sandboxCheckouts.id, checkoutId));
    if (!c) throw new NotFoundError("Checkout");
    const base = { providerPaymentId: c.paymentIntentId, refundedCents: c.refundedCents };
    if (c.paymentStatus === "paid") return { ...base, status: "succeeded" };
    if (c.status === "expired") return { ...base, status: "canceled" };
    if (c.paymentStatus === "processing") return { ...base, status: "processing" };
    if (c.paymentStatus === "failed") return { ...base, status: "failed", failureReason: "sandbox_delayed_failure" };
    return { ...base, status: "pending" };
  }

  async refund(args: { providerPaymentId: string; amountCents: number; idempotencyKey: string }) {
    const [c] = await db.select().from(sandboxCheckouts).where(eq(sandboxCheckouts.paymentIntentId, args.providerPaymentId));
    if (!c || c.paymentStatus !== "paid") throw new AppError("refund_failed", "Payment is not refundable.", 409);
    const total = Math.min(c.amountCents, c.refundedCents + args.amountCents);
    await db.update(sandboxCheckouts).set({ refundedCents: total }).where(eq(sandboxCheckouts.id, c.id));
    const ev = this.buildEvent("charge.refunded", {
      id: `ch_${c.paymentIntentId}`,
      object: "charge",
      payment_intent: c.paymentIntentId,
      amount: c.amountCents,
      amount_refunded: total,
      metadata: { aac_payment_id: c.paymentId },
    }, `evt_sandbox_refund_${args.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(-40)}`);
    await this.deliver(ev);
  }

  parseWebhook(rawBody: string, signatureHeader: string | null) {
    return normalizeStripeEvent(verifyStripeSignature(rawBody, signatureHeader, env.sandboxWebhookSecret));
  }

  /* ---- Simulation controls (used by the sandbox checkout page and tests) ---- */

  buildEvent(type: string, object: Record<string, unknown>, id = `evt_sandbox_${randomUUID().replace(/-/g, "")}`) {
    return { id, object: "event", type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object } };
  }

  sign(payload: string) {
    return Stripe.webhooks.generateTestHeaderString({ payload, secret: env.sandboxWebhookSecret });
  }

  /** Deliver a simulated event through the real webhook pipeline. */
  async deliver(event: object) {
    const { handlePaymentWebhook } = await import("../webhooks");
    const payload = JSON.stringify(event);
    return handlePaymentWebhook(this, payload, this.sign(payload));
  }

  sessionObject(c: typeof sandboxCheckouts.$inferSelect, paymentStatus: "paid" | "unpaid") {
    return {
      id: c.id,
      object: "checkout.session",
      client_reference_id: c.paymentId,
      payment_intent: c.paymentIntentId,
      payment_status: paymentStatus,
      amount_total: c.amountCents,
      currency: c.currency,
      metadata: { aac_payment_id: c.paymentId },
    };
  }

  /** Simulate the customer's action on the hosted checkout page. Returns the events emitted. */
  async simulate(checkoutId: string, outcome: SandboxOutcome) {
    const [c] = await db.select().from(sandboxCheckouts).where(eq(sandboxCheckouts.id, checkoutId));
    if (!c) throw new NotFoundError("Checkout");
    const events: object[] = [];
    const set = (v: Partial<typeof sandboxCheckouts.$inferInsert>) => db.update(sandboxCheckouts).set(v).where(eq(sandboxCheckouts.id, c.id));
    const open = c.status === "open";
    if (outcome === "success" && open) {
      await set({ status: "complete", paymentStatus: "paid" });
      events.push(this.buildEvent("checkout.session.completed", this.sessionObject(c, "paid")));
    } else if (outcome === "decline" && open) {
      events.push(
        this.buildEvent("payment_intent.payment_failed", {
          id: c.paymentIntentId,
          object: "payment_intent",
          metadata: { aac_payment_id: c.paymentId },
          last_payment_error: { code: "card_declined" },
        }),
      );
    } else if (outcome === "delayed" && open) {
      await set({ status: "complete", paymentStatus: "processing" });
      events.push(this.buildEvent("checkout.session.completed", this.sessionObject(c, "unpaid")));
    } else if (outcome === "delayed_success" && c.paymentStatus === "processing") {
      await set({ paymentStatus: "paid" });
      events.push(this.buildEvent("checkout.session.async_payment_succeeded", this.sessionObject(c, "paid")));
    } else if (outcome === "delayed_failure" && c.paymentStatus === "processing") {
      await set({ paymentStatus: "failed" });
      events.push(this.buildEvent("checkout.session.async_payment_failed", this.sessionObject(c, "unpaid")));
    } else if (outcome === "cancel" && open) {
      await set({ status: "expired" });
      events.push(this.buildEvent("checkout.session.expired", this.sessionObject(c, "unpaid")));
    } else {
      throw new AppError("sandbox_invalid_state", "That action is not available for this checkout.", 409);
    }
    for (const e of events) await this.deliver(e);
    return events;
  }
}
