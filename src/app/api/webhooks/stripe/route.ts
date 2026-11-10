import { AppError } from "@/lib/errors";
import { getPaymentProvider } from "@/modules/billing/providers";
import { handlePaymentWebhook } from "@/modules/billing/webhooks";

export const dynamic = "force-dynamic";

/**
 * Processor webhook endpoint. The signature is verified against the raw request body
 * before anything is parsed or stored. A 5xx response asks the processor to retry.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const result = await handlePaymentWebhook(getPaymentProvider(), raw, req.headers.get("stripe-signature"));
    return Response.json({ received: true, outcome: result.outcome });
  } catch (e) {
    if (e instanceof AppError && e.code === "invalid_signature") return Response.json({ error: "invalid signature" }, { status: 400 });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
