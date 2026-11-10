import { apiError } from "@/lib/action";
import { assertSameOrigin, json } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { cancelBooking } from "@/modules/booking/engine";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/bookings/:id — cancel under the terms accepted at booking. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const actor = await requireActor();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Booking");
    return json(req, { data: await cancelBooking(actor, id) });
  } catch (e) {
    return apiError(e);
  }
}
