import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { LedgerTable } from "@/components/ledger-table";
import { ActionForm } from "@/components/staff-form";
import { Badge, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/db";
import { membershipEvents } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { requireStaffPage } from "@/lib/session";
import { clubDate, formatDateOnly } from "@/lib/time";
import { listEntriesForHousehold } from "@/modules/billing/account";
import { can } from "@/modules/identity/actor";
import { getHouseholdOverview } from "@/modules/identity/households";
import { accountSettingsAction, membershipChangeAction, verifyGuardianAction } from "../../actions";

export default async function HouseholdPage({ params }: { params: Promise<{ householdId: string }> }) {
  const actor = await requireStaffPage("members.view");
  const { householdId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) notFound();
  let o;
  try {
    o = await getHouseholdOverview(actor, householdId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const m = o.current;
  const manage = can(actor, "members.manage");
  // Financial detail is shown only to roles that need it.
  const billing = can(actor, "billing.view") ? await listEntriesForHousehold(actor, householdId, { limit: 25 }) : null;
  const events = m ? await db.select().from(membershipEvents).where(eq(membershipEvents.membershipId, m.membership.id)).orderBy(desc(membershipEvents.effectiveDate), desc(membershipEvents.createdAt)) : [];
  // Contact details are limited to roles that work with members directly.
  const showContact = can(actor, "members.manage") || can(actor, "crm.manage") || can(actor, "checkin.perform");
  return (
    <>
      <PageHeader eyebrow="Household" title={o.household.name} actions={m ? <StatusBadge status={m.membership.status} /> : undefined} description={m ? `${m.plan.name} · ${formatMoney(m.membership.duesCents)} / ${m.plan.billingInterval} · since ${formatDateOnly(m.membership.startDate)}` : "No membership"} />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2" aria-labelledby="people">
          <h2 id="people" className="mb-2 text-lg font-semibold">People</h2>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Household members and permissions</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Permissions</th>{showContact ? <th scope="col">Contact</th> : null}</tr></thead>
              <tbody>
                {o.members.map((p) => {
                  const g = o.guardianships.filter((x) => x.childPersonId === p.personId);
                  return (
                    <tr key={p.personId}>
                      <td><span className="font-semibold">{p.firstName} {p.lastName}</span><span className="block font-mono text-xs text-ink-500">{p.memberNumber}</span></td>
                      <td className="capitalize">{p.role}{p.hasLogin ? <span className="block text-xs text-ink-500">has login</span> : null}</td>
                      <td>
                        {p.role === "dependent" ? g.map((x) => {
                          const guardian = o.members.find((y) => y.personId === x.guardianPersonId);
                          return (
                            <div key={x.guardianPersonId} className="text-xs">
                              Guardian: {guardian?.firstName} {x.verifiedAt ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>}
                              {!x.verifiedAt && manage ? <ActionForm action={verifyGuardianAction} submitLabel="Mark verified" hidden={{ guardianPersonId: x.guardianPersonId, childPersonId: p.personId }} buttonClass="btn btn-secondary btn-sm mt-1" /> : null}
                            </div>
                          );
                        }) : (
                          <span className="flex flex-wrap gap-1">{p.canBookForHousehold ? <Badge>books for family</Badge> : null}{p.canManageBilling ? <Badge>billing</Badge> : null}{p.canChargeAccount ? <Badge>charge{p.chargeLimitCents !== null ? ` ≤ ${formatMoney(p.chargeLimitCents)}` : ""}</Badge> : null}</span>
                        )}
                      </td>
                      {showContact ? <td className="text-xs">{p.email ?? "—"}<span className="block">{p.phone ?? ""}</span></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {billing ? (
            <>
              <h2 className="mb-2 mt-8 text-lg font-semibold">Club account · {billing.balanceCents >= 0 ? `${formatMoney(billing.balanceCents)} due` : `${formatMoney(-billing.balanceCents)} credit`}</h2>
              <LedgerTable entries={billing.entries} />
            </>
          ) : null}
        </section>
        <div className="space-y-6">
          {m && manage ? (
            <section className="card" aria-labelledby="change">
              <h2 id="change" className="text-lg font-semibold">Membership change</h2>
              <p className="text-xs text-ink-500">Changes are effective-dated. Future dates are applied automatically on that day.</p>
              <ActionForm action={membershipChangeAction} submitLabel="Record change" hidden={{ membershipId: m.membership.id }} className="mt-3 space-y-3" confirmText="Record this membership change?">
                <div><label className="label" htmlFor="type">Change</label><select className="input" id="type" name="type"><option value="freeze">Freeze</option><option value="unfreeze">Unfreeze</option><option value="cancel">Cancel</option></select></div>
                <div><label className="label" htmlFor="eff">Effective date</label><input className="input" id="eff" type="date" name="effectiveDate" defaultValue={clubDate()} required /></div>
                <div><label className="label" htmlFor="reason">Reason</label><input className="input" id="reason" name="reason" /></div>
              </ActionForm>
            </section>
          ) : null}
          {billing && can(actor, "billing.manage") ? (
            <section className="card" aria-labelledby="acct">
              <h2 id="acct" className="text-lg font-semibold">Club-account settings</h2>
              <ActionForm action={accountSettingsAction} submitLabel="Save settings" hidden={{ householdId }} className="mt-3 space-y-3" resetOnSuccess={false}>
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="chargeEnabled" defaultChecked={billing.account.chargeEnabled} className="h-4 w-4" />Allow “Charge to Club Account”</label>
                <div><label className="label" htmlFor="limit">Account limit (USD)</label><input className="input" id="limit" name="creditLimit" inputMode="decimal" defaultValue={(billing.account.creditLimitCents / 100).toFixed(2)} /></div>
                <div><label className="label" htmlFor="status">Account status</label><select className="input" id="status" name="status" defaultValue={billing.account.status}><option value="active">Active</option><option value="suspended">Suspended (overdue)</option></select></div>
              </ActionForm>
            </section>
          ) : null}
          <section className="card" aria-labelledby="hist">
            <h2 id="hist" className="text-lg font-semibold">Membership history</h2>
            <ol className="mt-2 space-y-2 text-sm">
              {events.map((e) => <li key={e.id}><span className="font-semibold capitalize">{e.type}</span> · effective {formatDateOnly(e.effectiveDate)} {e.appliedAt ? "" : <Badge tone="amber">scheduled</Badge>}</li>)}
              {events.length === 0 ? <li className="text-ink-500">No history.</li> : null}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
