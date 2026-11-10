/** Centralised, lazily-read environment configuration. Never import this into client components. */
function required(name: string, fallbackForDev?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (process.env.NODE_ENV !== "production" && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL", "postgres://aac:aac@localhost:5432/aac_dev");
  },
  get appUrl() {
    return required("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  get authSecret() {
    return required("BETTER_AUTH_SECRET", "dev-only-secret-change-me-0123456789abcdef");
  },
  get paymentProvider(): "sandbox" | "stripe" {
    return process.env.PAYMENT_PROVIDER === "stripe" ? "stripe" : "sandbox";
  },
  get stripeSecretKey() {
    return required("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
  get sandboxWebhookSecret() {
    return required("SANDBOX_WEBHOOK_SECRET", "whsec_sandbox_dev_only");
  },
  get jobsSecret() {
    return required("JOBS_SECRET", "dev-jobs-secret");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};
