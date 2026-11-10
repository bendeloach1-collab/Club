import Link from "next/link";
import { Alert, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requireMemberPage } from "@/lib/session";
import { formatClubDateTime } from "@/lib/time";
import { listHouseholdBookings } from "@/modules/booking/engine";
import { CancelButton } from "./cancel-button";

export default async function MySchedulePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireMemberPage();
  const all = await listHouseholdBookings(actor, { limit: 60 });
  const { upcoming, past } = split(all);
  const notice = (await searchParams).notice;
  return (
    <>
      <PageHeader eyebrow="My Schedule" title="Your household's bookings" description="Bookings confirmed by AAC. Appointments made on partner websites are managed there and are not listed here." actions={<Link href="/portal/book" className="btn btn-accent">Book a session</Link>} />
      {notice === "booked" ? <div className="mb-4"><Alert tone="success" title="You're booked">Your spot is confirmed.</Alert></div> : null}
      <h2 className="mb-2 text-lg font-semibold">Upcoming</h2>
      {upcoming.length === 0 ? <EmptyState title="No upcoming bookings" action={<Link href="/portal/book" className="btn btn-primary btn-sm">Browse the schedule</Link>} /> : <ul className="space-y-2">{upcoming.map((b) => <Row key={b.booking.id} b={b} cancellable />)}</ul>}
      {past.length > 0 ? (<><h2 className="mb-2 mt-8 text-lg font-semibold">History</h2><ul className="space-y-2">{past.map((b) => <Row key={b.booking.id} b={b} cancellable={false} />)}</ul></>) : null}
    </>
  );
}

type Item = Awaited<ReturnType<typeof listHouseholdBookings>>[number];

function split(all: Item[]) {
  const now = Date.now();
  const upcoming = all.filter((b) => b.startsAt && b.startsAt.getTime() > now && ["confirmed", "pending_payment"].includes(b.booking.status)).reverse();
  return { upcoming, past: all.filter((b) => !upcoming.includes(b)).slice(0, 20) };
}

function Row({ b, cancellable }: { b: Item; cancellable: boolean }) {
  return (
    <li className="card flex flex-wrap items-start justify-between gap-3 !p-4">
      <div className="min-w-0">
        <p className="font-semibold">{b.serviceName}</p>
        <p className="text-sm text-ink-500">{b.startsAt ? formatClubDateTime(b.startsAt) : "—"}{b.location ? ` · ${b.location}` : ""}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <StatusBadge status={b.booking.status} />
          <span>{b.participantFirst} {b.participantLast}</span>
          <span>{b.booking.priceCents ? `${formatMoney(b.booking.priceCents, b.booking.currency)} · ${b.booking.paymentMethod.replace("_", " ")}` : "Included"}</span>
        </p>
        {cancellable ? <p className="mt-1 text-xs text-ink-500">Free cancellation until {b.booking.terms.cancelWindowHours}h before start.</p> : null}
        {b.booking.status === "pending_payment" && b.booking.paymentId ? <Link href={`/portal/payment/${b.booking.paymentId}`} className="mt-1 inline-block text-xs font-semibold text-brass-700 underline">Complete payment to confirm your spot</Link> : null}
      </div>
      {cancellable ? <CancelButton bookingId={b.booking.id} label={`${b.serviceName} for ${b.participantFirst}`} /> : null}
    </li>
  );
}
