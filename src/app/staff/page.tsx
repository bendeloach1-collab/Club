import Link from "next/link";
import { ActionForm } from "@/components/staff-form";
import { Alert, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireStaffPage } from "@/lib/session";
import { addDays, clubDate, clubTimeToUtc, formatClubDateTime, formatClubLongDate, formatClubTime } from "@/lib/time";
import { operationsSummary } from "@/modules/billing/admin";
import { listSessions } from "@/modules/booking/engine";
import { openTasks, pipelineCounts, upcomingTours } from "@/modules/crm/leads";
import { can } from "@/modules/identity/actor";
import { completeTaskAction } from "./actions";

export default async function StaffToday({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireStaffPage();
  const forbidden = (await searchParams).notice === "forbidden";
  const today = clubDate();
  const crm = can(actor, "crm.manage");
  const [sessions, pipeline, tasks, tours, ops] = await Promise.all([
    can(actor, "schedule.view") ? listSessions({ from: clubTimeToUtc(today, "00:00"), to: clubTimeToUtc(addDays(today, 1), "00:00") }) : null,
    crm ? pipelineCounts(actor) : null,
    crm ? openTasks(actor, { limit: 8 }) : null,
    crm ? upcomingTours(actor, 6) : null,
    can(actor, "reports.view") ? operationsSummary(actor) : null,
  ]);
  const visibleSessions = sessions?.filter(() => true) ?? null;
  return (
    <>
      <PageHeader eyebrow="Staff console" title="Today" description={`${formatClubLongDate(new Date())} · Eastern Time`} />
      {forbidden ? <div className="mb-4"><Alert tone="warning" title="That area isn't available for your role">Ask a manager if you need access.</Alert></div> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pipeline ? <Stat label="Open leads" value={pipeline.new + pipeline.contacted + pipeline.tour_scheduled + pipeline.toured + pipeline.proposal} hint={`${pipeline.new} new`} /> : null}
        {tours ? <Stat label="Upcoming tours" value={tours.length} /> : null}
        {ops ? <Stat label="Active memberships" value={ops.membershipCounts.find((m) => m.status === "active")?.count ?? 0} hint={`${ops.membershipCounts.find((m) => m.status === "pending_payment")?.count ?? 0} awaiting payment`} /> : null}
        {ops && can(actor, "billing.view") ? <Stat label="Webhook failures" value={ops.failedWebhooks} hint={ops.failedWebhooks ? <Link className="underline" href="/staff/billing">Review</Link> : "None to review"} /> : null}
        {visibleSessions ? <Stat label="Sessions today" value={visibleSessions.length} hint={`${visibleSessions.reduce((n, s) => n + s.booked, 0)} booked`} /> : null}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {visibleSessions ? (
          <section aria-labelledby="today-sessions">
            <h2 id="today-sessions" className="mb-2 text-lg font-semibold">Today&apos;s sessions</h2>
            {visibleSessions.length === 0 ? <EmptyState title="No sessions today" /> : (
              <ul className="space-y-2">
                {visibleSessions.map((s) => (
                  <li key={s.sessionId} className="card flex items-center justify-between gap-3 !p-3 text-sm">
                    <span><span className="font-semibold tabular-nums">{formatClubTime(s.startsAt)}</span> · {s.serviceName}{s.location ? ` · ${s.location}` : ""}</span>
                    <Link className="font-semibold text-brass-700 hover:underline" href={`/staff/schedule/${s.sessionId}`}>{s.booked}/{s.capacity} roster</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {tasks ? (
          <section aria-labelledby="tasks">
            <h2 id="tasks" className="mb-2 text-lg font-semibold">Follow-up tasks</h2>
            {tasks.length === 0 ? <EmptyState title="No open tasks" /> : (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.task.id} className="card flex flex-wrap items-center justify-between gap-3 !p-3 text-sm">
                    <span><Link className="font-semibold hover:underline" href={`/staff/leads/${t.task.leadId}`}>{t.leadFirst} {t.leadLast}</Link> · {t.task.title}<span className={`block text-xs ${t.task.dueAt < new Date() ? "font-semibold text-red-700" : "text-ink-500"}`}>Due {formatClubDateTime(t.task.dueAt)}</span></span>
                    <ActionForm action={completeTaskAction} submitLabel="Done" hidden={{ taskId: t.task.id }} buttonClass="btn btn-secondary btn-sm" className="flex items-center gap-2" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {tours ? (
          <section aria-labelledby="tours">
            <h2 id="tours" className="mb-2 text-lg font-semibold">Upcoming tours</h2>
            {tours.length === 0 ? <EmptyState title="No tours scheduled" /> : (
              <ul className="space-y-2">
                {tours.map((t) => <li key={t.tour.id} className="card !p-3 text-sm"><span className="font-semibold">{formatClubDateTime(t.tour.scheduledAt)}</span> · <Link className="hover:underline" href={`/staff/leads/${t.tour.leadId}`}>{t.leadFirst} {t.leadLast}</Link></li>)}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
