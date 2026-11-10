import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ScheduleList, WeekNav, weekRange, weekWindow } from "@/components/schedule-list";
import { ActionForm } from "@/components/staff-form";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { resources, services } from "@/db/schema";
import { requireStaffPage } from "@/lib/session";
import { clubDate } from "@/lib/time";
import { listSessions } from "@/modules/booking/engine";
import { can } from "@/modules/identity/actor";
import { listStaff } from "@/modules/identity/households";
import { createSessionAction } from "../actions";

export default async function StaffSchedulePage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const actor = await requireStaffPage("schedule.view");
  const { start, endExclusive } = weekRange((await searchParams).start);
  const [items, svc, res, staff] = await Promise.all([
    listSessions(weekWindow(start, endExclusive, true)),
    db.select().from(services).where(eq(services.bookingMode, "native")).orderBy(asc(services.name)),
    db.select().from(resources).where(eq(resources.isActive, true)).orderBy(asc(resources.name)),
    listStaff(),
  ]);
  return (
    <>
      <PageHeader eyebrow="Schedule" title="Sessions" description="Club-local times (Eastern). Select a session to see its roster." />
      <WeekNav basePath="/staff/schedule" start={start} />
      <ScheduleList items={items.map((i) => ({ ...i, spotsLeft: Math.max(i.spotsLeft, 1) }))} hrefFor={(i) => `/staff/schedule/${i.sessionId}`} cta="Roster" />
      {can(actor, "schedule.manage") ? (
        <details className="card mt-8">
          <summary className="cursor-pointer text-lg font-semibold">Schedule sessions</summary>
          <ActionForm action={createSessionAction} submitLabel="Create" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className="label" htmlFor="serviceId">Service</label><select className="input" id="serviceId" name="serviceId" required>{svc.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} min)</option>)}</select></div>
            <div><label className="label" htmlFor="date">First date</label><input className="input" id="date" type="date" name="date" min={clubDate()} required /></div>
            <div><label className="label" htmlFor="time">Start time (ET)</label><input className="input" id="time" type="time" name="time" required /></div>
            <div><label className="label" htmlFor="resourceId">Room / resource</label><select className="input" id="resourceId" name="resourceId"><option value="">None</option>{res.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <div><label className="label" htmlFor="coachUserId">Coach</label><select className="input" id="coachUserId" name="coachUserId"><option value="">Unassigned</option>{staff.filter((s) => s.roles.includes("coach")).map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}</select></div>
            <div><label className="label" htmlFor="capacity">Capacity (blank = default)</label><input className="input" id="capacity" name="capacity" type="number" min={1} /></div>
            <div><label className="label" htmlFor="repeatWeeks">Repeat weekly for … more weeks</label><input className="input" id="repeatWeeks" name="repeatWeeks" type="number" min={0} max={26} defaultValue={0} /></div>
            <p className="text-xs text-ink-500 sm:col-span-2 lg:col-span-3">A room can only be used by one session at a time; conflicting requests are rejected in full.</p>
          </ActionForm>
        </details>
      ) : null}
      <p className="mt-4 text-xs text-ink-500"><Link className="underline" href="/schedule">View the public schedule</Link></p>
    </>
  );
}
