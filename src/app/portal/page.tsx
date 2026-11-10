import Link from "next/link";
import { eq } from "drizzle-orm";
import { PartnerCardView } from "@/components/partner-card";
import { Alert, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/db";
import { persons } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { requireMemberPage } from "@/lib/session";
import { formatClubDateTime } from "@/lib/time";
import { getBalance } from "@/modules/billing/ledger";
import { listHouseholdBookings } from "@/modules/booking/engine";
import { householdPermissions } from "@/modules/identity/actor";
import { getHouseholdOverview } from "@/modules/identity/households";
import { listPartnerCards } from "@/modules/partners/partners";

export default async function PortalHome() {
  const actor = await requireMemberPage();
  const householdId = actor.householdIds[0]!;
  const [[me], overview, upcoming, partners, perm] = await Promise.all([
    db.select().from(persons).where(eq(persons.id, actor.personId)),
    getHouseholdOverview(actor, householdId),
    listHouseholdBookings(actor, { upcoming: true, limit: 4 }),
    listPartnerCards(actor),
    householdPermissions(db, actor.personId, householdId),
  ]);
  const m = overview.current;
  const balance = perm?.canManageBilling && overview.billing ? await getBalance(db, overview.billing.id) : null;
  return (
    <>
      <PageHeader eyebrow={m ? `${m.plan.name} membership` : "Member portal"} title={`Welcome, ${me!.firstName}`} actions={<Link href="/portal/book" className="btn btn-accent">Book a session</Link>} />
      {m?.membership.status === "pending_payment" ? (
        <div className="mb-6"><Alert tone="warning" title="Complete your enrollment">Your membership starts once your first payment is confirmed. <Link className="font-semibold underline" href="/portal/account">Finish payment</Link></Alert></div>
      ) : m && m.membership.status !== "active" ? (
        <div className="mb-6"><Alert tone="info" title={`Your membership is ${m.membership.status}`}>Booking and club access are paused. Please contact the front desk with any questions.</Alert></div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2" aria-labelledby="upcoming">
          <div className="mb-2 flex items-center justify-between"><h2 id="upcoming" className="text-lg font-semibold">Coming up</h2><Link href="/portal/schedule" className="text-sm font-semibold text-brass-700 hover:underline">My schedule →</Link></div>
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming bookings" action={<Link href="/portal/book" className="btn btn-primary btn-sm">Browse the schedule</Link>}>Classes and training you book will appear here.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((b) => (
                <li key={b.booking.id} className="card flex flex-wrap items-center justify-between gap-2 !p-4">
                  <div><p className="font-semibold">{b.serviceName}</p><p className="text-xs text-ink-500">{b.startsAt ? formatClubDateTime(b.startsAt) : ""}{b.location ? ` · ${b.location}` : ""} · {b.participantFirst}</p></div>
                  <StatusBadge status={b.booking.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="membership" className="space-y-4">
          <div className="card">
            <h2 id="membership" className="text-lg font-semibold">Membership</h2>
            {m ? <p className="mt-1 flex items-center gap-2 text-sm">{m.plan.name} <StatusBadge status={m.membership.status} /></p> : <p className="mt-1 text-sm text-ink-500">No membership on file.</p>}
            <p className="mt-2 text-xs text-ink-500">Member ID</p>
            <p className="font-mono text-sm font-semibold">{me!.memberNumber}</p>
            <Link href="/portal/account#card" className="mt-3 inline-block text-sm font-semibold text-brass-700 hover:underline">Show member card →</Link>
          </div>
          {balance !== null ? (
            <div className="card">
              <h2 className="text-lg font-semibold">Club account</h2>
              <p className="mt-1 text-2xl font-semibold">{formatMoney(Math.abs(balance))}</p>
              <p className="text-xs text-ink-500">{balance > 0 ? "Balance due" : balance < 0 ? "Credit on account" : "Nothing due"}</p>
              <Link href="/portal/account" className="mt-3 inline-block text-sm font-semibold text-brass-700 hover:underline">View statement →</Link>
            </div>
          ) : null}
        </section>
      </div>
      {partners.length > 0 ? (
        <section className="mt-8" aria-labelledby="partners">
          <div className="mb-2 flex items-center justify-between"><h2 id="partners" className="text-lg font-semibold">Partner services</h2><Link href="/portal/services" className="text-sm font-semibold text-brass-700 hover:underline">All services →</Link></div>
          <div className="grid gap-4 md:grid-cols-2">{partners.slice(0, 4).map((p) => <PartnerCardView key={p.slug} card={p} detailHref={`/portal/services/${p.slug}`} />)}</div>
        </section>
      ) : null}
    </>
  );
}
