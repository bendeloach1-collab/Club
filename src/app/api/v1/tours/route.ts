import { apiError } from "@/lib/action";
import { json, preflight, rateLimit } from "@/lib/api";
import { scheduleTour } from "@/modules/crm/leads";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** POST /api/v1/tours — { lead: {...}, scheduledAt: ISO } books an open tour slot. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "tours", 6);
    const body = await req.json().catch(() => ({}));
    const r = await scheduleTour(body as never);
    return json(req, { data: { tourId: r.tourId } }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
