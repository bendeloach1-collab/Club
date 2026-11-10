import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff-form";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { requireStaffPage } from "@/lib/session";
import { formatClubLongDate, formatClubTime } from "@/lib/time";
import { sessionRoster } from "@/modules/booking/engine";
import { can } from "@/modules/identity/actor";
import { attendanceAction, cancelSessionAction } from "../../actions";

export default async function RosterPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage("schedule.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data;
  try {
    data = await sessionRoster(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { session, service, roster } = data;
  return (
    <>
      <PageHeader eyebrow="Roster" title={service.name} description={`${formatClubLongDate(session.startsAt)} · ${formatClubTime(session.startsAt)} – ${formatClubTime(session.endsAt)} ET${data.coachName ? ` · ${data.coachName}` : ""}`} actions={<StatusBadge status={session.status} />} />
      <p className="mb-3 text-sm text-ink-500">{roster.filter((r) => r.status !== "no_show").length} of {session.capacity} places taken</p>
      {roster.length === 0 ? <EmptyState title="No one has booked yet" /> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Participants</caption>
            <thead><tr><th scope="col">Participant</th><th scope="col">Status</th><th scope="col">Attendance</th></tr></thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.bookingId}>
                  <td><span className="font-semibold">{r.firstName} {r.lastName}</span><span className="block font-mono text-xs text-ink-500">{r.memberNumber}</span></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    {r.status === "pending_payment" ? <span className="text-xs text-ink-500">Awaiting payment</span> : (
                      <div className="flex flex-wrap gap-2">
                        <ActionForm action={attendanceAction} submitLabel="Attended" hidden={{ bookingId: r.bookingId, status: "attended" }} buttonClass="btn btn-secondary btn-sm" />
                        <ActionForm action={attendanceAction} submitLabel="No-show" hidden={{ bookingId: r.bookingId, status: "no_show" }} buttonClass="btn btn-secondary btn-sm" confirmText={service.noShowFeeCents ? "Mark as no-show? The no-show fee in the member's accepted terms will be charged to their club account." : undefined} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-start gap-4">
        <Link href="/staff/schedule" className="btn btn-secondary btn-sm">← Schedule</Link>
        {can(actor, "schedule.manage") && session.status === "scheduled" ? <ActionForm action={cancelSessionAction} submitLabel="Cancel this session" hidden={{ sessionId: session.id }} buttonClass="btn btn-danger btn-sm" confirmText="Cancel this session? All bookings will be cancelled and any charges reversed or refunded." /> : null}
      </div>
    </>
  );
}
