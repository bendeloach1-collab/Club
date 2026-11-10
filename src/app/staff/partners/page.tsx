import Link from "next/link";
import { Alert, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaffPage } from "@/lib/session";
import { listPartnersAdmin } from "@/modules/partners/partners";

export default async function PartnersAdminPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const actor = await requireStaffPage("partners.manage");
  const rows = await listPartnersAdmin(actor);
  return (
    <>
      <PageHeader eyebrow="Partner services" title="Service directory" description="Partners appear in the member dashboard, Services directory and service pages. A launch only opens the partner's site — it never confirms a booking or payment." actions={<Link href="/staff/partners/new" className="btn btn-primary">Add partner service</Link>} />
      {(await searchParams).saved ? <div className="mb-4"><Alert tone="success" title="Partner service saved" /></div> : null}
      {rows.length === 0 ? <EmptyState title="No partner services yet" action={<Link href="/staff/partners/new" className="btn btn-primary btn-sm">Add the first one</Link>} /> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Partner services</caption>
            <thead><tr><th scope="col">Order</th><th scope="col">Service</th><th scope="col">Connection</th><th scope="col">Visibility</th><th scope="col">Status</th><th scope="col">Health check</th></tr></thead>
            <tbody>
              {rows.map(({ partner: p, problems }) => (
                <tr key={p.id}>
                  <td className="tabular-nums">{p.displayOrder}</td>
                  <td><Link className="font-semibold text-brass-700 hover:underline" href={`/staff/partners/${p.id}`}>{p.name}</Link><span className="block text-xs text-ink-500">{p.category} · /{p.slug}</span></td>
                  <td className="capitalize">{p.connectionMode.replace("_", " ")}<span className="block text-xs text-ink-500">{p.launchTarget === "new_tab" ? "new tab" : "same tab"}</span></td>
                  <td className="capitalize">{p.visibility.audience}{p.visibility.audience === "plans" ? <span className="block text-xs text-ink-500">{(p.visibility.planCodes ?? []).join(", ") || "no plans selected"}</span> : null}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="text-xs">{problems.length === 0 ? (p.status === "active" ? "Configuration valid" : "—") : <ul className="list-disc pl-4 text-red-800">{problems.map((x) => <li key={x}>{x}</li>)}</ul>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
