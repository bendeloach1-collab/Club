/**
 * Payment-processor adapter. AAC owns memberships, privileges and the club-account ledger;
 * the provider only executes payments and reports processor status.
 */
export type CheckoutRequest = {
  paymentId: string;
  amountCents: number;
  currency: string;
  description: string;
  customerEmail?: string | null;
  providerCustomerId?: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Forwarded to the provider so a retried request cannot create a second charge. */
  idempotencyKey: string;
  /** Ask the provider to keep the payment method for authorised future (off-session) use. */
  savePaymentMethod?: boolean;
};

export type CheckoutResult = { checkoutId: string; url: string; providerPaymentId?: string | null };

export type ProviderPaymentState = {
  status: "pending" | "requires_action" | "processing" | "succeeded" | "failed" | "canceled";
  providerPaymentId?: string | null;
  refundedCents?: number;
  failureReason?: string | null;
};

/** Provider events reduced to the facts AAC acts on. */
export type NormalizedPaymentEvent = {
  eventId: string;
  type: string;
  /** How to find our payment row. */
  paymentId?: string | null;
  checkoutId?: string | null;
  providerPaymentId?: string | null;
  update:
    | { kind: "succeeded" }
    | { kind: "processing" }
    | { kind: "requires_action" }
    | { kind: "attempt_failed"; reason: string | null }
    | { kind: "failed"; reason: string | null }
    | { kind: "canceled" }
    | { kind: "refunded"; refundedCentsTotal: number }
    | { kind: "ignored" };
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: "stripe" | "sandbox";
  /** True for the simulated processor. Surfaces must label it clearly. */
  readonly isSandbox: boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Trusted server-side state, used on return from checkout and by reconciliation. */
  retrieveCheckout(checkoutId: string): Promise<ProviderPaymentState>;
  refund(args: { providerPaymentId: string; amountCents: number; idempotencyKey: string }): Promise<void>;
  /** Verify the signature over the raw body and normalise. Throws if the signature is invalid. */
  parseWebhook(rawBody: string, signatureHeader: string | null): NormalizedPaymentEvent;
}
