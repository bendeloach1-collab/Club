import { EmptyState, PageHeader, Pager } from "@/components/ui";
import { requireStaffPage } from "@/lib/session";
import { formatClubDateTime } from "@/lib/time";
import { listAudit } from "@/modules/billing/admin";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; type?: string }> }) {
  const actor = await requireStaffPage("audit.view");
  const sp = await searchParams;
  const list = await listAudit(actor, { page: Number(sp.page ?? 1), entityType: sp.type || undefined });
  return (
    <>
      <PageHeader eyebrow="Audit" title="Audit log" description="Append-only record of membership, booking, financial and permission changes." />
      <form className="mb-4 flex gap-2">
        <label className="sr-only" htmlFor="type">Record type</label>
        <select id="type" name="type" defaultValue={sp.type ?? ""} className="input max-w-xs"><option value="">All records</option>{["membership", "booking", "payment", "person", "billing_account", "partner_service", "lead", "session"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select>
        <button className="btn btn-secondary">Filter</button>
      </form>
      {list.rows.length === 0 ? <EmptyState title="No audit records" /> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Audit records, most recent first</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Detail</th></tr></thead>
            <tbody>{list.rows.map(({ a, actorName }) => <tr key={a.id}><td className="whitespace-nowrap">{formatClubDateTime(a.createdAt)}</td><td>{actorName ?? "System"}</td><td className="font-mono text-xs">{a.action}</td><td className="text-xs">{a.entityType}<span className="block font-mono text-ink-500">{a.entityId?.slice(0, 8)}</span></td><td className="max-w-xs break-words font-mono text-xs text-ink-500">{JSON.stringify(a.data)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <Pager basePath="/staff/audit" page={list.page} hasMore={list.hasMore} params={{ type: sp.type }} />
    </>
  );
}
