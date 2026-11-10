import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requireStaffPage } from "@/lib/session";
import { operationsSummary } from "@/modules/billing/admin";
import { conversionReport } from "@/modules/crm/leads";
import { can } from "@/modules/identity/actor";

export default async function ReportsPage() {
  const actor = await requireStaffPage("reports.view");
  const [conv, ops] = await Promise.all([conversionReport(actor), operationsSummary(actor)]);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const totals = conv.reduce((t, r) => ({ leads: t.leads + r.leads, toured: t.toured + r.toured, won: t.won + r.won }), { leads: 0, toured: 0, won: 0 });
  const paid = ops.paymentTotals.filter((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status));
  return (
    <>
      <PageHeader eyebrow="Reports" title="Conversion and operations" description="Leads created in the last 90 days, by source." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Leads (90 days)" value={totals.leads} />
        <Stat label="Lead → tour" value={pct(totals.toured, totals.leads)} hint={`${totals.toured} toured`} />
        <Stat label="Lead → member" value={pct(totals.won, totals.leads)} hint={`${totals.won} joined`} />
        {can(actor, "billing.view") ? <Stat label="Collected (net)" value={formatMoney(paid.reduce((s, p) => s + p.totalCents - p.refundedCents, 0))} hint={`${paid.reduce((s, p) => s + p.count, 0)} payments`} /> : <Stat label="Active memberships" value={ops.membershipCounts.find((m) => m.status === "active")?.count ?? 0} />}
      </div>
      <h2 className="mb-2 mt-8 text-lg font-semibold">Conversion by source</h2>
      {conv.length === 0 ? <EmptyState title="No leads in this period" /> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Lead conversion by source</caption>
            <thead><tr><th scope="col">Source</th><th scope="col" className="text-right">Leads</th><th scope="col" className="text-right">Toured</th><th scope="col" className="text-right">Joined</th><th scope="col" className="text-right">Lost</th><th scope="col" className="text-right">Conversion</th></tr></thead>
            <tbody>{conv.map((r) => <tr key={r.source}><td>{r.source}</td><td className="text-right tabular-nums">{r.leads}</td><td className="text-right tabular-nums">{r.toured}</td><td className="text-right tabular-nums">{r.won}</td><td className="text-right tabular-nums">{r.lost}</td><td className="text-right tabular-nums">{pct(r.won, r.leads)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <h2 className="mb-2 mt-8 text-lg font-semibold">Memberships by status</h2>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">{ops.membershipCounts.map((m) => <Stat key={m.status} label={m.status.replace("_", " ")} value={m.count} />)}</div>
    </>
  );
}
