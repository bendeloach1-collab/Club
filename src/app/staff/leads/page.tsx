import Link from "next/link";
import { ActionForm } from "@/components/staff-form";
import { EmptyState, PageHeader, Pager, StatusBadge } from "@/components/ui";
import { LEAD_STAGES } from "@/db/schema";
import { requireStaffPage } from "@/lib/session";
import { formatClubDate } from "@/lib/time";
import { listLeads, pipelineCounts } from "@/modules/crm/leads";
import { createLeadAction } from "../actions";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ stage?: string; q?: string; mine?: string; page?: string }> }) {
  const actor = await requireStaffPage("crm.manage");
  const sp = await searchParams;
  const [counts, list] = await Promise.all([pipelineCounts(actor), listLeads(actor, { stage: sp.stage, q: sp.q, mine: sp.mine === "1", page: Number(sp.page ?? 1) })]);
  const qs = (stage?: string) => { const q = new URLSearchParams(); if (stage) q.set("stage", stage); if (sp.q) q.set("q", sp.q); if (sp.mine) q.set("mine", "1"); return `/staff/leads?${q}`; };
  return (
    <>
      <PageHeader eyebrow="CRM" title="Leads and tours" description="Inquiries are de-duplicated by email and phone. A lead is marked won automatically when its membership is activated." />
      <nav aria-label="Pipeline stage" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <Link href={qs()} className={`btn btn-sm ${!sp.stage ? "btn-primary" : "btn-secondary"}`}>All</Link>
        {LEAD_STAGES.map((s) => <Link key={s} href={qs(s)} className={`btn btn-sm whitespace-nowrap capitalize ${sp.stage === s ? "btn-primary" : "btn-secondary"}`}>{s.replace("_", " ")} <span className="tabular-nums opacity-70">{counts[s]}</span></Link>)}
      </nav>
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        {sp.stage ? <input type="hidden" name="stage" value={sp.stage} /> : null}
        <label className="sr-only" htmlFor="q">Search leads</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Name, email or phone" className="input max-w-xs" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} className="h-4 w-4" />Assigned to me</label>
        <button className="btn btn-secondary">Search</button>
      </form>
      {list.rows.length === 0 ? <EmptyState title="No leads match">Adjust the filters, or add a walk-in or phone inquiry below.</EmptyState> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Leads</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Stage</th><th scope="col">Interest</th><th scope="col">Source</th><th scope="col">Owner</th><th scope="col">Last activity</th></tr></thead>
            <tbody>
              {list.rows.map(({ lead, assigneeName }) => (
                <tr key={lead.id}>
                  <td><Link href={`/staff/leads/${lead.id}`} className="font-semibold text-brass-700 hover:underline">{lead.firstName} {lead.lastName}</Link><span className="block text-xs text-ink-500">{lead.email ?? lead.phone}</span></td>
                  <td><StatusBadge status={lead.stage} /></td>
                  <td className="capitalize">{lead.interest ?? "—"}</td>
                  <td>{lead.source}{lead.utmSource ? <span className="block text-xs text-ink-500">{lead.utmSource}{lead.utmMedium ? ` / ${lead.utmMedium}` : ""}</span> : null}</td>
                  <td>{assigneeName ?? "Unassigned"}</td>
                  <td className="whitespace-nowrap">{formatClubDate(lead.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager basePath="/staff/leads" page={list.page} hasMore={list.hasMore} params={{ stage: sp.stage, q: sp.q, mine: sp.mine }} />
      <details className="card mt-8">
        <summary className="cursor-pointer text-lg font-semibold">Add a lead</summary>
        <ActionForm action={createLeadAction} submitLabel="Add lead" className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="nl-f">First name</label><input className="input" id="nl-f" name="firstName" required /></div>
          <div><label className="label" htmlFor="nl-l">Last name</label><input className="input" id="nl-l" name="lastName" required /></div>
          <div><label className="label" htmlFor="nl-e">Email</label><input className="input" id="nl-e" name="email" type="email" /></div>
          <div><label className="label" htmlFor="nl-p">Phone</label><input className="input" id="nl-p" name="phone" type="tel" /></div>
          <div><label className="label" htmlFor="nl-s">Source</label><select className="input" id="nl-s" name="source"><option value="walk_in">Walk-in</option><option value="phone">Phone</option><option value="referral">Referral</option><option value="event">Event</option></select></div>
          <div><label className="label" htmlFor="nl-i">Interest</label><select className="input" id="nl-i" name="interest"><option value="">Unknown</option><option>individual</option><option>couple</option><option>family</option><option>corporate</option></select></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="nl-m">Notes</label><textarea className="input" id="nl-m" name="message" rows={2} /></div>
        </ActionForm>
      </details>
    </>
  );
}
