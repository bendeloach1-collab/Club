import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { LedgerTable } from "@/components/ledger-table";
import { Alert, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/db";
import { persons } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { requireMemberPage } from "@/lib/session";
import { formatClubDate, formatDateOnly } from "@/lib/time";
import { listEntriesForHousehold } from "@/modules/billing/account";
import { householdPermissions } from "@/modules/identity/actor";
import { getHouseholdOverview } from "@/modules/identity/households";
import { PayBalanceForm, RetryEnrollmentForm } from "./forms";

export default async function AccountPage() {
  const actor = await requireMemberPage();
  const householdId = actor.householdIds[0]!;
  const [[me], overview, perm] = await Promise.all([db.select().from(persons).where(eq(persons.id, actor.personId)), getHouseholdOverview(actor, householdId), householdPermissions(db, actor.personId, householdId)]);
  const billing = perm?.canManageBilling ? await listEntriesForHousehold(actor, householdId) : null;
  const m = overview.current;
  // The code only locates the member record; staff still verify status on the server.
  const qr = await QRCode.toString(me!.memberNumber, { type: "svg", margin: 1, width: 160 });
  return (
    <>
      <PageHeader eyebrow="Account" title="Membership and club account" />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card" aria-labelledby="mem">
          <h2 id="mem" className="text-lg font-semibold">Membership</h2>
          {m ? (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Plan</dt><dd className="font-semibold">{m.plan.name}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Status</dt><dd><StatusBadge status={m.membership.status} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Dues</dt><dd>{formatMoney(m.membership.duesCents, m.membership.currency)} / {m.plan.billingInterval}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink-500">Member since</dt><dd>{formatDateOnly(m.membership.startDate)}</dd></div>
              {m.membership.nextBillingDate && m.membership.status === "active" ? <div className="flex justify-between gap-2"><dt className="text-ink-500">Next dues date</dt><dd>{formatDateOnly(m.membership.nextBillingDate)}</dd></div> : null}
            </dl>
          ) : <p className="mt-2 text-sm text-ink-500">No membership on file.</p>}
          {m?.membership.status === "pending_payment" && perm?.canManageBilling ? <div className="mt-4"><RetryEnrollmentForm membershipId={m.membership.id} /></div> : null}
          <p className="mt-4 text-xs text-ink-500">To freeze, change or cancel your membership, contact the front desk. Changes take effect on the date the club confirms.</p>
        </section>

        <section id="card" className="card text-center" aria-labelledby="idcard">
          <h2 id="idcard" className="text-lg font-semibold">Digital member card</h2>
          <div className="mx-auto mt-3 w-40" role="img" aria-label={`QR code for member ID ${me!.memberNumber}`} dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-2 font-semibold">{me!.firstName} {me!.lastName}</p>
          <p className="font-mono text-sm">{me!.memberNumber}</p>
          <p className="mt-2 text-xs text-ink-500">Show this at the front desk to check in.</p>
        </section>

        <section className="card" aria-labelledby="bal">
          <h2 id="bal" className="text-lg font-semibold">Club account</h2>
          {billing ? (
            <>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{formatMoney(Math.abs(billing.balanceCents), billing.account.currency)}</p>
              <p className="text-sm text-ink-500">{billing.balanceCents > 0 ? "Balance due" : billing.balanceCents < 0 ? "Credit on account" : "Nothing due"}</p>
              <p className="mt-2 text-xs text-ink-500">{billing.account.chargeEnabled ? `Charging enabled · limit ${formatMoney(billing.account.creditLimitCents, billing.account.currency)}` : "Charge to Club Account is not enabled for this household."}</p>
              {billing.balanceCents > 0 ? <div className="mt-4"><PayBalanceForm householdId={householdId} idempotencyKey={randomUUID()} label={`Pay ${formatMoney(billing.balanceCents, billing.account.currency)} now`} /></div> : null}
            </>
          ) : <p className="mt-2 text-sm text-ink-500">You don&apos;t have billing access for this household. The primary member can grant it on the Family page.</p>}
        </section>
      </div>

      {billing ? (
        <>
          <h2 className="mb-2 mt-8 text-lg font-semibold">Account activity</h2>
          <LedgerTable entries={billing.entries} />
          <h2 className="mb-2 mt-8 text-lg font-semibold">Payments</h2>
          {billing.payments.length === 0 ? <Alert tone="info">No payments yet.</Alert> : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Payments</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">For</th><th scope="col">Status</th><th scope="col" className="text-right">Amount</th></tr></thead>
                <tbody>
                  {billing.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{formatClubDate(p.createdAt)}</td>
                      <td><a className="font-medium text-brass-700 hover:underline" href={`/portal/payment/${p.id}`}>{p.lineItems.map((l) => l.description).join(", ")}</a></td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className="whitespace-nowrap text-right tabular-nums">{formatMoney(p.amountCents, p.currency)}{p.refundedCents ? <span className="block text-xs text-ink-500">refunded {formatMoney(p.refundedCents, p.currency)}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
