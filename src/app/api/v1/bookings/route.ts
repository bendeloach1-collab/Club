import { apiError } from "@/lib/action";
import { assertSameOrigin, json } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { startCheckout } from "@/modules/billing/payments";
import { bookSession, listHouseholdBookings } from "@/modules/booking/engine";

export const dynamic = "force-dynamic";

const view = (b: Awaited<ReturnType<typeof listHouseholdBookings>>[number]) => ({
  id: b.booking.id,
  status: b.booking.status,
  /** Always "aac": only bookings confirmed by AAC appear here, never partner appointments. */
  confirmedBy: "aac",
  service: b.serviceName,
  startsAt: b.startsAt?.toISOString() ?? null,
  participant: `${b.participantFirst} ${b.participantLast}`,
  priceCents: b.booking.priceCents,
  currency: b.booking.currency,
  paymentMethod: b.booking.paymentMethod,
  terms: b.booking.terms,
});

/** GET /api/v1/bookings — the signed-in member's household bookings. */
export async function GET(req: Request) {
  try {
    const actor = await requireActor();
    const rows = await listHouseholdBookings(actor, { upcoming: new URL(req.url).searchParams.get("upcoming") === "1" });
    return json(req, { data: rows.map(view) });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/v1/bookings — book a session. Requires the `Idempotency-Key` header; a retried
 * request returns the original booking. Identical validation to the portal.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const actor = await requireActor();
    const key = req.headers.get("idempotency-key");
    if (!key) throw new ValidationError("The Idempotency-Key header is required.", "idempotency_key_required");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await bookSession(actor, { ...(body as object), idempotencyKey: key } as never);
    let checkoutUrl: string | null = null;
    if (r.paymentId && r.booking.status === "pending_payment") {
      const page = `/portal/payment/${r.paymentId}`;
      checkoutUrl = (await startCheckout(r.paymentId, { successPath: page, cancelPath: page })).url;
    }
    return json(req, { data: { id: r.booking.id, status: r.booking.status, confirmedBy: "aac", priceCents: r.booking.priceCents, terms: r.booking.terms, paymentId: r.paymentId, checkoutUrl, replayed: r.replayed } }, { status: r.replayed ? 200 : 201 });
  } catch (e) {
    return apiError(e);
  }
}
