import { apiError } from "@/lib/action";
import { json, preflight, rateLimit } from "@/lib/api";
import { captureLead } from "@/modules/crm/leads";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** POST /api/v1/leads — public lead capture. The response never reveals whether the contact is already known. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "leads", 8);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body && !body.company) await captureLead(body as never);
    else if (!body) await captureLead({} as never);
    return json(req, { data: { received: true } }, { status: 202 });
  } catch (e) {
    return apiError(e);
  }
}
