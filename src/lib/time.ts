/**
 * Club-time helpers. All instants are stored in UTC; anything a human schedules or reads
 * is interpreted in the club's zone so daylight-saving changes are handled by the tz database.
 */
export const CLUB_TZ = "America/New_York";

function partsInZone(d: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(d)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset (ms) of `timeZone` from UTC at instant `d`. */
function offsetMs(d: Date, timeZone: string) {
  const p = partsInZone(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * Convert a club-local wall time ("2026-03-08", "06:30") to the UTC instant.
 * Non-existent times in the spring-forward gap resolve to the instant after the gap;
 * ambiguous fall-back times resolve to the first (daylight) occurrence.
 */
export function clubTimeToUtc(dateStr: string, timeStr: string, timeZone = CLUB_TZ): Date {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const [hh, mm] = timeStr.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two-pass resolution handles offsets that change between the guess and the answer.
  const first = wall - offsetMs(new Date(wall), timeZone);
  const second = wall - offsetMs(new Date(first), timeZone);
  if (first === second) return new Date(first);
  // Gap or overlap: pick the earlier valid instant, or the post-gap instant if neither round-trips.
  const candidates = [first, second].sort((a, b) => a - b);
  for (const c of candidates) {
    const p = partsInZone(new Date(c), timeZone);
    if (p.hour === hh && p.minute === mm && p.day === d) return new Date(c);
  }
  return new Date(Math.max(first, second));
}

/** YYYY-MM-DD of an instant in club time. */
export function clubDate(d: Date = new Date(), timeZone = CLUB_TZ): string {
  const p = partsInZone(d, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Add calendar days to a YYYY-MM-DD string (pure date arithmetic, DST-safe). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Add months to a YYYY-MM-DD date, clamping to the end of shorter months. */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: CLUB_TZ, ...opts });
const dateFmt = fmt({ weekday: "short", month: "short", day: "numeric" });
const longDateFmt = fmt({ weekday: "long", month: "long", day: "numeric" });
const timeFmt = fmt({ hour: "numeric", minute: "2-digit" });
const dateTimeFmt = fmt({ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const formatClubDate = (d: Date) => dateFmt.format(d);
export const formatClubLongDate = (d: Date) => longDateFmt.format(d);
export const formatClubTime = (d: Date) => timeFmt.format(d);
export const formatClubDateTime = (d: Date) => dateTimeFmt.format(d);
export const formatDateOnly = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
};
