import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff-form";
import { Badge, PageHeader, StatusBadge } from "@/components/ui";
import { LEAD_STAGES } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireStaffPage } from "@/lib/session";
import { addDays, clubDate, formatClubDateTime } from "@/lib/time";
import { getLead } from "@/modules/crm/leads";
import { listStaff } from "@/modules/identity/households";
import { addActivityAction, addTaskAction, completeTaskAction, tourStatusAction, updateLeadAction } from "../../actions";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage("crm.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data;
  try {
    data = await getLead(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { lead } = data;
  const staff = (await listStaff()).filter((s) => s.roles.some((r) => ["sales", "manager", "admin"].includes(r)));
  const closed = lead.stage === "won" || lead.stage === "lost";
  return (
    <>
      <PageHeader eyebrow="Lead" title={`${lead.firstName} ${lead.lastName}`} description={[lead.email, lead.phone].filter(Boolean).join(" · ")} actions={<StatusBadge status={lead.stage} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card" aria-labelledby="log">
            <h2 id="log" className="text-lg font-semibold">Log an interaction</h2>
            <ActionForm action={addActivityAction} submitLabel="Add to history" hidden={{ leadId: lead.id }} className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-3">{(["note", "call", "email", "sms"] as const).map((t, i) => <label key={t} className="flex items-center gap-2 text-sm capitalize"><input type="radio" name="type" value={t} defaultChecked={i === 0} />{t}</label>)}</div>
              <label className="sr-only" htmlFor="body">Details</label>
              <textarea className="input" id="body" name="body" rows={3} required placeholder="What happened?" />
            </ActionForm>
          </section>
          <section aria-labelledby="history">
            <h2 id="history" className="mb-2 text-lg font-semibold">History</h2>
            <ol className="space-y-2">
              {data.activities.map(({ a, by }) => (
                <li key={a.id} className="card !p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500"><Badge>{a.type.replace("_", " ")}</Badge>{formatClubDateTime(a.createdAt)}{by ? ` · ${by}` : ""}</p>
                  <p className="mt-1 whitespace-pre-line">{a.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div className="space-y-6">
          <section className="card text-sm" aria-labelledby="details">
            <h2 id="details" className="text-lg font-semibold">Details</h2>
            <dl className="mt-2 space-y-1.5">
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Interest</dt><dd className="capitalize">{lead.interest ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Source</dt><dd>{lead.source}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Campaign</dt><dd>{[lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean).join(" / ") || "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Owner</dt><dd>{data.assigneeName ?? "Unassigned"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Marketing email</dt><dd>{lead.marketingEmailOptIn ? "Opted in" : "Not opted in"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Marketing SMS</dt><dd>{lead.marketingSmsOptIn ? "Opted in" : "Not opted in"}</dd></div>
              {lead.lostReason ? <div className="flex justify-between gap-2"><dt className="text-ink-500">Lost reason</dt><dd>{lead.lostReason}</dd></div> : null}
            </dl>
            {lead.stage === "won" ? <p className="mt-3 rounded bg-emerald-50 p-2 text-emerald-900">Converted to a member. History is retained on this record.</p> : <Link className="btn btn-accent btn-sm mt-4" href={`/join?plan=${["individual", "couple", "family"].includes(lead.interest ?? "") ? lead.interest : "individual"}`}>Start enrollment</Link>}
          </section>
          {!closed ? (
            <section className="card" aria-labelledby="stage">
              <h2 id="stage" className="text-lg font-semibold">Stage and owner</h2>
              <ActionForm action={updateLeadAction} submitLabel="Update" hidden={{ leadId: lead.id }} className="mt-3 space-y-3" resetOnSuccess={false}>
                <div><label className="label" htmlFor="stage-sel">Stage</label><select className="input" id="stage-sel" name="stage" defaultValue={lead.stage}>{LEAD_STAGES.filter((s) => s !== "won").map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
                <div><label className="label" htmlFor="lost">Reason (if lost)</label><input className="input" id="lost" name="lostReason" /></div>
                <div><label className="label" htmlFor="owner">Owner</label><select className="input" id="owner" name="assignedToUserId" defaultValue={lead.assignedToUserId ?? ""}><option value="">Unassigned</option>{staff.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}</select></div>
              </ActionForm>
            </section>
          ) : null}
          <section className="card" aria-labelledby="tours">
            <h2 id="tours" className="text-lg font-semibold">Tours</h2>
            {data.tours.length === 0 ? <p className="mt-1 text-sm text-ink-500">No tours yet. Tours are booked from the public tour page.</p> : (
              <ul className="mt-2 space-y-3 text-sm">
                {data.tours.map((t) => (
                  <li key={t.id}>
                    <p className="flex items-center justify-between gap-2"><span>{formatClubDateTime(t.scheduledAt)}</span><StatusBadge status={t.status} /></p>
                    {t.status === "scheduled" ? (
                      <div className="mt-1 flex gap-2">
                        <ActionForm action={tourStatusAction} submitLabel="Completed" hidden={{ tourId: t.id, status: "completed" }} buttonClass="btn btn-secondary btn-sm" />
                        <ActionForm action={tourStatusAction} submitLabel="No-show" hidden={{ tourId: t.id, status: "no_show" }} buttonClass="btn btn-secondary btn-sm" />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card" aria-labelledby="tasks">
            <h2 id="tasks" className="text-lg font-semibold">Follow-up tasks</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {data.tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span className={t.completedAt ? "text-ink-500 line-through" : ""}>{t.title}<span className="block text-xs text-ink-500">Due {formatClubDateTime(t.dueAt)}</span></span>
                  {!t.completedAt ? <ActionForm action={completeTaskAction} submitLabel="Done" hidden={{ taskId: t.id }} buttonClass="btn btn-secondary btn-sm" /> : null}
                </li>
              ))}
            </ul>
            <ActionForm action={addTaskAction} submitLabel="Add task" hidden={{ leadId: lead.id }} className="mt-3 space-y-2 border-t border-line pt-3">
              <label className="sr-only" htmlFor="task-title">Task</label><input className="input" id="task-title" name="title" placeholder="e.g. Call back about family plan" required />
              <div className="flex gap-2"><label className="sr-only" htmlFor="due-date">Due date</label><input className="input" id="due-date" type="date" name="dueDate" defaultValue={addDays(clubDate(), 1)} required /><label className="sr-only" htmlFor="due-time">Due time</label><input className="input" id="due-time" type="time" name="dueTime" defaultValue="09:00" /></div>
            </ActionForm>
          </section>
        </div>
      </div>
    </>
  );
}
