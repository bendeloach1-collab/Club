import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { SubmitButton } from "@/components/forms";
import { Alert, SandboxBanner } from "@/components/ui";
import { db } from "@/db";
import { sandboxCheckouts } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { getPaymentProvider } from "@/modules/billing/providers";
import { simulateAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sandbox checkout", robots: { index: false } };

function Btn({ id, outcome, label, className = "btn btn-secondary w-full" }: { id: string; outcome: string; label: string; className?: string }) {
  return (
    <form action={simulateAction}>
      <input type="hidden" name="checkoutId" value={id} />
      <input type="hidden" name="outcome" value={outcome} />
      <SubmitButton className={className} pendingLabel="Processing…">{label}</SubmitButton>
    </form>
  );
}

export default async function SandboxCheckoutPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ declined?: string }> }) {
  if (!getPaymentProvider().isSandbox) notFound();
  const { id } = await params;
  const [c] = await db.select().from(sandboxCheckouts).where(eq(sandboxCheckouts.id, id));
  if (!c) notFound();
  return (
    <>
      <SandboxBanner>SANDBOX PAYMENT PAGE — simulated processor. No card is collected and no money moves.</SandboxBanner>
      <main id="main" className="mx-auto max-w-md px-4 py-10">
        <div className="card">
          <p className="eyebrow">Simulated hosted checkout</p>
          <h1 className="mt-1 text-2xl font-semibold">{formatMoney(c.amountCents, c.currency)}</h1>
          <p className="text-sm text-ink-500">{c.description}</p>
          {(await searchParams).declined ? <div className="mt-4"><Alert tone="error" title="Card declined (simulated)">Try another outcome below.</Alert></div> : null}
          <div className="mt-6 space-y-2">
            {c.status === "open" ? (
              <>
                <Btn id={c.id} outcome="success" label="Pay — simulate successful card payment" className="btn btn-primary w-full" />
                <Btn id={c.id} outcome="decline" label="Simulate declined card" />
                <Btn id={c.id} outcome="delayed" label="Simulate bank debit (settles later)" />
                <Btn id={c.id} outcome="cancel" label="Cancel and return" />
              </>
            ) : c.paymentStatus === "processing" ? (
              <>
                <Alert tone="info" title="Bank debit in progress">Choose how the delayed payment resolves.</Alert>
                <Btn id={c.id} outcome="delayed_success" label="Simulate: bank debit succeeded" className="btn btn-primary w-full" />
                <Btn id={c.id} outcome="delayed_failure" label="Simulate: bank debit failed" />
              </>
            ) : (
              <Alert tone="info" title="This checkout is closed">Status: {c.status} / {c.paymentStatus}. <a className="font-semibold underline" href={c.successUrl}>Return to the club</a>.</Alert>
            )}
          </div>
          <p className="mt-6 text-xs text-ink-500">In production this page is replaced by Stripe-hosted Checkout. Simulated outcomes are delivered to AAC as signed webhook events through the same code path as Stripe events.</p>
        </div>
      </main>
    </>
  );
}
