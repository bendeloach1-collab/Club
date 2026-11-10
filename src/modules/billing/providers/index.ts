import { env } from "@/lib/env";
import { SandboxProvider } from "./sandbox";
import { StripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

let cached: PaymentProvider | undefined;

/** The configured payment adapter. Missing Stripe credentials only affect live payments. */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;
  cached = env.paymentProvider === "stripe" ? new StripeProvider() : new SandboxProvider();
  return cached;
}

/** Test hook. */
export function setPaymentProvider(p: PaymentProvider | undefined) {
  cached = p;
}

export type PaymentProviderHealth = { provider: string; mode: "sandbox" | "live" | "test"; configured: boolean; problems: string[] };

export function paymentProviderHealth(): PaymentProviderHealth {
  if (env.paymentProvider !== "stripe") {
    return { provider: "sandbox", mode: "sandbox", configured: true, problems: [] };
  }
  const problems: string[] = [];
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) problems.push("STRIPE_SECRET_KEY is not set.");
  else if (!/^(sk|rk)_(test|live)_/.test(key)) problems.push("STRIPE_SECRET_KEY does not look like a Stripe secret or restricted key.");
  if (!(process.env.STRIPE_WEBHOOK_SECRET ?? "").startsWith("whsec_")) problems.push("STRIPE_WEBHOOK_SECRET is missing or malformed.");
  return { provider: "stripe", mode: key.includes("_live_") ? "live" : "test", configured: problems.length === 0, problems };
}
