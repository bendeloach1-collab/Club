import Stripe from "stripe";
import { env } from "@/lib/env";
import { normalizeStripeEvent, verifyStripeSignature } from "./stripe-events";
import type { CheckoutRequest, CheckoutResult, PaymentProvider, ProviderPaymentState } from "./types";

/**
 * Live Stripe adapter using Stripe-hosted Checkout (mode=payment). Card and bank details
 * are entered on Stripe and never reach AAC servers.
 *
 * AAC is the single owner of recurring billing schedules: this adapter deliberately creates
 * no Stripe Subscriptions or Stripe Invoices, so dues can never be collected twice.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly isSandbox = false;
  private client: Stripe;

  constructor(secretKey = env.stripeSecretKey, private webhookSecret = env.stripeWebhookSecret) {
    this.client = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15000 });
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: req.paymentId,
        ...(req.providerCustomerId
          ? { customer: req.providerCustomerId }
          : { customer_email: req.customerEmail ?? undefined, customer_creation: "always" as const }),
        line_items: [
          {
            quantity: 1,
            price_data: { currency: req.currency, unit_amount: req.amountCents, product_data: { name: req.description } },
          },
        ],
        // Only opaque identifiers travel to Stripe; no member details beyond the payer email.
        metadata: { aac_payment_id: req.paymentId },
        payment_intent_data: {
          metadata: { aac_payment_id: req.paymentId },
          ...(req.savePaymentMethod ? { setup_future_usage: "off_session" as const } : {}),
        },
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
      },
      { idempotencyKey: `checkout:${req.idempotencyKey}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    const pi = session.payment_intent;
    return { checkoutId: session.id, url: session.url, providerPaymentId: typeof pi === "string" ? pi : (pi?.id ?? null) };
  }

  async retrieveCheckout(checkoutId: string): Promise<ProviderPaymentState> {
    const s = await this.client.checkout.sessions.retrieve(checkoutId, { expand: ["payment_intent.latest_charge"] });
    const pi = s.payment_intent && typeof s.payment_intent !== "string" ? s.payment_intent : null;
    const charge = pi?.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
    const base = { providerPaymentId: pi?.id ?? null, refundedCents: charge?.amount_refunded ?? 0 };
    if (s.payment_status === "paid") return { ...base, status: "succeeded" };
    if (s.status === "expired") return { ...base, status: "canceled" };
    if (s.status === "complete") {
      // Session finished but funds not confirmed: a delayed method is in flight or failed.
      if (pi?.status === "requires_payment_method") return { ...base, status: "failed", failureReason: pi.last_payment_error?.code ?? null };
      return { ...base, status: "processing" };
    }
    if (pi?.status === "requires_action") return { ...base, status: "requires_action" };
    return { ...base, status: "pending" };
  }

  async refund(args: { providerPaymentId: string; amountCents: number; idempotencyKey: string }) {
    await this.client.refunds.create(
      { payment_intent: args.providerPaymentId, amount: args.amountCents },
      { idempotencyKey: `refund:${args.idempotencyKey}` },
    );
  }

  parseWebhook(rawBody: string, signatureHeader: string | null) {
    return normalizeStripeEvent(verifyStripeSignature(rawBody, signatureHeader, this.webhookSecret));
  }
}
