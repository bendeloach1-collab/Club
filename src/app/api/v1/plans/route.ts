import { apiError } from "@/lib/action";
import { json, preflight } from "@/lib/api";
import { listPublicPlans } from "@/modules/membership/plans";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** GET /api/v1/plans — public membership plans and prices (the same data the enrollment flow enforces). */
export async function GET(req: Request) {
  try {
    const plans = await listPublicPlans();
    return json(req, { data: plans.map((p) => ({ code: p.code, name: p.name, type: p.type, description: p.description, benefits: p.benefits, duesCents: p.duesCents, enrollmentFeeCents: p.enrollmentFeeCents, currency: p.currency, billingInterval: p.billingInterval, maxAdults: p.maxAdults, maxDependents: p.maxDependents })) }, { cache: "public, max-age=60" });
  } catch (e) {
    return apiError(e);
  }
}
