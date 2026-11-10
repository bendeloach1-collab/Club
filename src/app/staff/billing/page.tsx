import Link from "next/link";
import { ActionForm } from "@/components/staff-form";
import { Alert, EmptyState, PageHeader, Pager, StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requireStaffPage } from "@/lib/session";
import { formatClubDateTime } from "@/lib/time";
import { listPayments, listWebhookEvents } from "@/modules/billing/admin";
import { getPaymentProvider } from "@/modules/billing/providers";
import { can } from "@/modules/identity/actor";
import { refundAction, retryWebhookAction } from "../actions";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const actor = await requireStaffPage("billing.view");
  const sp = await searchParams;
  const [list, events] = await Promise.all([listPayments(actor, { page: Number(sp.page ?? 1), status: sp.status }), listWebhookEvents(actor)]);
  const manage = can(actor, "billing.manage");
  const failed = events.filter((e) => e.status === "failed");
  return (
    <>
      <PageHeader eyebrow="Billing" title="Payments and processor events" description="AAC owns the club-account ledger; the processor executes payments and reports their status." />
      {getPaymentProvider().isSandbox ? <div className="mb-4"><Alert tone="warning" title="Sandbox processor">These payments are simulated. No money has moved.</Alert></div> : null}
      {failed.length > 0 ? <div className="mb-4"><Alert tone="error" title={`${failed.length} processor event(s) failed to apply`}>Review them below. The processor will also retry delivery automatically.</Alert></div> : null}
      <h2 className="mb-2 text-lg font-semibold">Payments</h2>
      {list.rows.length === 0 ? <EmptyState title="No payments yet" /> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Payments</caption>
            <thead><tr><th scope="col">Created</th><th scope="col">Household</th><th scope="col">For</th><th scope="col">Status</th><th scope="col" className="text-right">Amount</th>{manage ? <th scope="col">Refund</th> : null}</tr></thead>
            <tbody>
              {list.rows.map(({ p, householdId, householdName }) => {
                const refundable = p.amountCents - p.refundedCents;
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{formatClubDateTime(p.createdAt)}</td>
                    <td><Link className="font-semibold text-brass-700 hover:underline" href={`/staff/members/${householdId}`}>{householdName}</Link></td>
                    <td>{p.lineItems.map((l) => l.description).join(", ")}<span className="block text-xs text-ink-500">{p.provider}{p.failureReason ? ` · ${p.failureReason}` : ""}</span></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="whitespace-nowrap text-right tabular-nums">{formatMoney(p.amountCents, p.currency)}{p.refundedCents ? <span className="block text-xs text-ink-500">−{formatMoney(p.refundedCents, p.currency)} refunded</span> : null}</td>
                    {manage ? (
                      <td>
                        {["succeeded", "partially_refunded"].includes(p.status) && refundable > 0 ? (
                          <details>
                            <summary className="cursor-pointer text-xs font-semibold text-brass-700">Refund…</summary>
                            <ActionForm action={refundAction} submitLabel="Refund" hidden={{ paymentId: p.id }} className="mt-2 w-44 space-y-2" buttonClass="btn btn-danger btn-sm" confirmText="Send this refund to the original payment method?">
                              <label className="sr-only" htmlFor={`amt-${p.id}`}>Amount</label><input className="input" id={`amt-${p.id}`} name="amount" inputMode="decimal" defaultValue={(refundable / 100).toFixed(2)} />
                              <label className="sr-only" htmlFor={`rsn-${p.id}`}>Reason</label><input className="input" id={`rsn-${p.id}`} name="reason" placeholder="Reason" required />
                              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="creditCharge" defaultChecked />Also credit the related charge</label>
                            </ActionForm>
                          </details>
                        ) : <span className="text-xs text-ink-500">—</span>}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager basePath="/staff/billing" page={list.page} hasMore={list.hasMore} params={{ status: sp.status }} />
      <h2 className="mb-2 mt-8 text-lg font-semibold">Processor events</h2>
      {events.length === 0 ? <EmptyState title="No processor events received yet" /> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Recent webhook events, failures first</caption>
            <thead><tr><th scope="col">Received</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{formatClubDateTime(e.receivedAt)}</td>
                  <td className="font-mono text-xs">{e.type}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td className="text-xs">{e.error ?? "—"}{e.status === "failed" && manage ? <ActionForm action={retryWebhookAction} submitLabel="Retry" hidden={{ eventId: e.id }} buttonClass="btn btn-secondary btn-sm mt-1" /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
