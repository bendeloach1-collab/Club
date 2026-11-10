import { apiError } from "@/lib/action";
import { json, preflight } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { addDays, clubDate, clubTimeToUtc } from "@/lib/time";
import { listSessions } from "@/modules/booking/engine";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/v1/schedule?from=YYYY-MM-DD&days=7&category=class — public schedule with live availability. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const from = q.get("from") ?? clubDate();
    const days = Number(q.get("days") ?? 7);
    if (!DATE.test(from) || !Number.isInteger(days) || days < 1 || days > 31) throw new ValidationError("from must be YYYY-MM-DD and days between 1 and 31.");
    const start = new Date(Math.max(Date.now(), clubTimeToUtc(from, "00:00").getTime()));
    const items = await listSessions({ from: start, to: clubTimeToUtc(addDays(from, days), "00:00"), category: q.get("category") ?? undefined });
    return json(req, { timeZone: "America/New_York", data: items.map((i) => ({ sessionId: i.sessionId, service: { slug: i.serviceSlug, name: i.serviceName, category: i.category }, startsAt: i.startsAt.toISOString(), endsAt: i.endsAt.toISOString(), coach: i.coachName, location: i.location, capacity: i.capacity, spotsLeft: i.spotsLeft, memberPriceCents: i.priceCents, currency: i.currency })) }, { cache: "public, max-age=15" });
  } catch (e) {
    return apiError(e);
  }
}
