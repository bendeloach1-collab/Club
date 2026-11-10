import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { addDays, clubDate, clubTimeToUtc, formatClubLongDate, formatClubTime, formatDateOnly } from "@/lib/time";
import type { ScheduleItem } from "@/modules/booking/engine";

/** Week pager + day-grouped agenda, shared by the public schedule, the portal and embeds. */
export function WeekNav({ basePath, start, extra = "" }: { basePath: string; start: string; extra?: string }) {
  const today = clubDate();
  const prev = addDays(start, -7);
  return (
    <nav aria-label="Week" className="mb-4 flex items-center justify-between gap-2">
      {prev >= today ? <Link className="btn btn-secondary btn-sm" href={`${basePath}?start=${prev}${extra}`}>← Earlier</Link> : start > today ? <Link className="btn btn-secondary btn-sm" href={`${basePath}?start=${today}${extra}`}>← This week</Link> : <span />}
      <p className="text-sm font-semibold text-ink-800">{formatDateOnly(start)} – {formatDateOnly(addDays(start, 6))}</p>
      <Link className="btn btn-secondary btn-sm" href={`${basePath}?start=${addDays(start, 7)}${extra}`}>Later →</Link>
    </nav>
  );
}

export function ScheduleList({ items, hrefFor, cta = "Book" }: { items: ScheduleItem[]; hrefFor?: (i: ScheduleItem) => string; cta?: string }) {
  if (items.length === 0) return <EmptyState title="Nothing scheduled this week">Try the next week, or check back soon — new sessions are added regularly.</EmptyState>;
  const days = new Map<string, ScheduleItem[]>();
  for (const i of items) {
    const k = formatClubLongDate(i.startsAt);
    days.set(k, [...(days.get(k) ?? []), i]);
  }
  return (
    <div className="space-y-6">
      {[...days].map(([day, list]) => (
        <section key={day} aria-label={day}>
          <h2 className="mb-2 border-b border-line pb-1 text-base font-semibold text-ink-800">{day}</h2>
          <ul className="space-y-2">
            {list.map((i) => (
              <li key={i.sessionId} className="card flex flex-wrap items-center gap-x-4 gap-y-2 !p-4">
                <div className="w-20 shrink-0 text-sm font-semibold tabular-nums text-ink-950">{formatClubTime(i.startsAt)}</div>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="font-semibold text-ink-950">{i.serviceName}</p>
                  <p className="text-xs text-ink-500">{[i.coachName, i.location, `${Math.round((i.endsAt.getTime() - i.startsAt.getTime()) / 60000)} min`].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={i.priceCents ? "brass" : "neutral"}>{i.priceCents ? formatMoney(i.priceCents, i.currency) : "Included"}</Badge>
                  {i.spotsLeft === 0 ? <Badge tone="red">Full</Badge> : <Badge tone={i.spotsLeft <= 3 ? "amber" : "green"}>{i.spotsLeft} left</Badge>}
                </div>
                {hrefFor && i.spotsLeft > 0 ? <Link href={hrefFor(i)} className="btn btn-primary btn-sm" aria-label={`${cta} ${i.serviceName} at ${formatClubTime(i.startsAt)} on ${day}`}>{cta}</Link> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** UTC query window for a club-local week, never starting in the past. */
export function weekWindow(start: string, endExclusive: string, includePast = false) {
  const from = clubTimeToUtc(start, "00:00");
  return { from: includePast ? from : new Date(Math.max(Date.now(), from.getTime())), to: clubTimeToUtc(endExclusive, "00:00") };
}

export function weekRange(start?: string) {
  const today = clubDate();
  const s = start && /^\d{4}-\d{2}-\d{2}$/.test(start) && start >= today ? start : today;
  return { start: s, endExclusive: addDays(s, 7) };
}
