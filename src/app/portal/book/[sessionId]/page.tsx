import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { requireMemberPage } from "@/lib/session";
import { formatClubLongDate, formatClubTime } from "@/lib/time";
import { quoteBooking, type BookingQuote } from "@/modules/booking/engine";
import { getHouseholdOverview } from "@/modules/identity/households";
import { ConfirmForm } from "./confirm-form";

export default async function ConfirmBookingPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ for?: string }> }) {
  const actor = await requireMemberPage();
  const { sessionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) notFound();
  const overview = await getHouseholdOverview(actor, actor.householdIds[0]!);
  const me = overview.members.find((m) => m.personId === actor.personId)!;
  const selectable = me.canBookForHousehold ? overview.members : [me];
  const requested = (await searchParams).for;
  const participant = selectable.find((m) => m.personId === requested) ?? me;

  let quote: BookingQuote;
  try {
    quote = await quoteBooking(actor, sessionId, participant.personId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { session, service, terms } = quote;
  const priceLabel = terms.priceCents ? formatMoney(terms.priceCents, terms.currency) : "Included";
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Confirm booking" title={service.name} description={`${formatClubLongDate(session.startsAt)} · ${formatClubTime(session.startsAt)} – ${formatClubTime(session.endsAt)} ET`} />
      <div className="card space-y-5">
        <p className="text-sm text-ink-500">{service.description}</p>
        {selectable.length > 1 ? (
          <div>
            <p className="label">Who is this for?</p>
            <div className="flex flex-wrap gap-2">
              {selectable.map((m) => (
                <Link key={m.personId} href={`/portal/book/${sessionId}?for=${m.personId}`} aria-current={m.personId === participant.personId ? "true" : undefined} className={`btn btn-sm ${m.personId === participant.personId ? "btn-primary" : "btn-secondary"}`}>{m.firstName}</Link>
              ))}
            </div>
          </div>
        ) : null}
        {quote.eligible ? (
          <>
            <p className="text-sm"><span className="font-semibold">{quote.spotsLeft}</span> {quote.spotsLeft === 1 ? "spot" : "spots"} left · booking for <span className="font-semibold">{participant.firstName} {participant.lastName}</span></p>
            <ConfirmForm sessionId={sessionId} participantPersonId={participant.personId} policyVersion={terms.policyVersion} priceCents={terms.priceCents} priceLabel={priceLabel} options={quote.paymentOptions} idempotencyKey={randomUUID()} termsSummary={terms.summary} />
          </>
        ) : (
          <Alert tone="warning" title="This session can't be booked right now">{quote.ineligibleReason}</Alert>
        )}
      </div>
      <Link href="/portal/book" className="mt-4 inline-block text-sm font-semibold text-brass-700 hover:underline">← Back to schedule</Link>
    </div>
  );
}
