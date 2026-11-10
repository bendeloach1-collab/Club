import { apiError } from "@/lib/action";
import { json, preflight } from "@/lib/api";
import { availableTourSlots } from "@/modules/crm/leads";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** GET /api/v1/tours/slots — open tour times for the next two weeks. */
export async function GET(req: Request) {
  try {
    const slots = await availableTourSlots();
    return json(req, { timeZone: "America/New_York", data: slots.map((s) => s.toISOString()) });
  } catch (e) {
    return apiError(e);
  }
}
