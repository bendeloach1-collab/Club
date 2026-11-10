import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Alert, PageHeader, StatusBadge } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { reportError } from "@/lib/log";
import { formatMoney } from "@/lib/money";
import { requireMemberPage } from "@/lib/session";
import { getPaymentForActor } from "@/modules/billing/account";
import { syncPaymentFromProvider } from "@/modules/billing/payments";
import { ResumeCheckoutForm } from "../../account/forms";

/**
 * Where the processor sends the member back. Arriving here proves nothing: the page asks
 * the processor for the payment's real state on the server and renders that.
 */
export default async function PaymentStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireMemberPage();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let p;
  try {
    p = await getPaymentForActor(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  let providerDown = false;
  if (["pending", "requires_action", "processing"].includes(p.status)) {
    try {
      p = await syncPaymentFromProvider(p.id);
    } catch (e) {
      providerDown = true;
      reportError("payment.sync_failed", e, { paymentId: p.id });
    }
  }
  const next = p.purpose === "booking" ? { href: "/portal/schedule", label: "Go to My Schedule" } : p.purpose === "enrollment" ? { href: "/portal", label: "Go to your member home" } : { href: "/portal/account", label: "Back to account" };
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Payment" title={formatMoney(p.amountCents, p.currency)} description={p.lineItems.map((l) => l.description).join(", ")} actions={<StatusBadge status={p.status} />} />
      <div className="card space-y-4">
        {p.status === "succeeded" ? (
          <Alert tone="success" title="Payment confirmed">{p.purpose === "enrollment" ? "Welcome to Athens Athletic Club — your membership is active." : p.purpose === "booking" ? "Your booking is confirmed." : "Thank you. Your club account has been credited."}</Alert>
        ) : p.status === "processing" ? (
          <><Alert tone="info" title="Payment is processing">Your bank payment has been submitted and can take a few business days to clear. {p.purpose === "booking" ? "Your spot is held in the meantime." : "We will activate everything as soon as it clears."}</Alert><AutoRefresh /></>
        ) : p.status === "pending" || p.status === "requires_action" ? (
          <>
            <Alert tone="warning" title={p.failureReason ? "Your last attempt didn't go through" : "Payment not completed yet"}>{providerDown ? "We couldn't reach the payment processor to check. Nothing has been charged twice — please try again in a moment." : p.failureReason ? "No charge was made. You can try again with the same or a different payment method." : p.purpose === "booking" ? "Your spot is held for a short time while you complete payment." : "You can complete payment now."}</Alert>
            <ResumeCheckoutForm paymentId={p.id} />
          </>
        ) : p.status === "failed" || p.status === "canceled" ? (
          <Alert tone="error" title={p.status === "failed" ? "Payment failed" : "Payment cancelled"}>No charge was made. {p.purpose === "booking" ? "The spot has been released — you can book again from the schedule." : p.purpose === "enrollment" ? "You can restart payment from your Account page." : "You can try again from your Account page."}</Alert>
        ) : (
          <Alert tone="info" title={p.status === "refunded" ? "Payment refunded" : "Payment partially refunded"}>{formatMoney(p.refundedCents, p.currency)} was returned to your original payment method.</Alert>
        )}
        <Link href={p.status === "failed" || p.status === "canceled" ? (p.purpose === "booking" ? "/portal/book" : "/portal/account") : next.href} className="btn btn-secondary">{p.status === "failed" || p.status === "canceled" ? "Continue" : next.label}</Link>
      </div>
    </div>
  );
}
