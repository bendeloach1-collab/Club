import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { partnerServices, webhookEvents } from "@/db/schema";
import { requireStaffPage } from "@/lib/session";
import { formatClubDateTime } from "@/lib/time";
import { paymentProviderHealth } from "@/modules/billing/providers";
import { validatePartnerConfig } from "@/modules/partners/partners";

function Card({ name, badge, tone, children }: { name: string; badge: string; tone: "green" | "amber" | "red" | "neutral"; children: React.ReactNode }) {
  return (
    <section className="card" aria-label={name}>
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{name}</h2><Badge tone={tone}>{badge}</Badge></div>
      <div className="mt-2 space-y-1.5 text-sm text-ink-800">{children}</div>
    </section>
  );
}

export default async function IntegrationsPage() {
  await requireStaffPage("integrations.manage");
  const pay = paymentProviderHealth();
  const [[lastOk], [failed], partners] = await Promise.all([
    db.select({ at: webhookEvents.processedAt }).from(webhookEvents).where(eq(webhookEvents.status, "processed")).orderBy(desc(webhookEvents.processedAt)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(webhookEvents).where(eq(webhookEvents.status, "failed")),
    db.select().from(partnerServices),
  ]);
  const partnerProblems = partners.filter((p) => p.status === "active" && validatePartnerConfig(p).length > 0).length;
  return (
    <>
      <PageHeader eyebrow="Integrations" title="Connections and health" description="Each provider sits behind an adapter. Missing credentials disable only that provider's live features." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card name="Payments" badge={pay.mode === "sandbox" ? "Sandbox (simulated)" : pay.configured ? `Stripe ${pay.mode}` : "Not configured"} tone={pay.mode === "sandbox" ? "amber" : pay.configured ? "green" : "red"}>
          {pay.mode === "sandbox" ? <p>The built-in sandbox processor is active. <strong>No real payments are collected.</strong> Set <code>PAYMENT_PROVIDER=stripe</code>, <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code> to use Stripe.</p> : null}
          {pay.problems.map((p) => <p key={p} className="text-red-800">⚠ {p}</p>)}
          <p>Webhook endpoint: <code>/api/webhooks/stripe</code> (signature verified).</p>
          <p>Last event applied: {lastOk?.at ? formatClubDateTime(lastOk.at) : "none yet"}.</p>
          <p>Events needing review: <strong>{failed?.n ?? 0}</strong> {failed?.n ? <Link className="underline" href="/staff/billing">Open billing</Link> : null}</p>
          <p className="text-xs text-ink-500">Permissions used: create Checkout Sessions, read PaymentIntents/Charges, create Refunds. AAC schedules recurring dues itself — no Stripe Subscriptions or Invoices are created.</p>
        </Card>
        <Card name="Partner links" badge={partnerProblems ? `${partnerProblems} need attention` : `${partners.filter((p) => p.status === "active").length} active`} tone={partnerProblems ? "red" : "green"}>
          <p>{partners.length} partner services configured; {partners.filter((p) => p.status === "unconfigured").length} unconfigured.</p>
          <p>Every destination is validated against its approved domains on save and again at launch.</p>
          <p><Link className="font-semibold text-brass-700 underline" href="/staff/partners">Manage partner services</Link></p>
        </Card>
        <Card name="Shopify" badge="Not built — Milestone 3" tone="neutral">
          <p>Retail order, refund and fulfilment sync with verified customer linking is planned. Nothing is synchronised today.</p>
        </Card>
        <Card name="Website components" badge="API only — Milestone 3" tone="neutral">
          <p>The versioned public API (<code>/api/v1</code>) is live for plans, schedule, leads and tours. Embeddable components and hosted pages are planned.</p>
        </Card>
        <Card name="Partner SSO / API connections" badge="Not built — Milestone 3" tone="neutral">
          <p>Partners set to SSO or API mode currently behave as plain links. No sign-in handoff or record exchange occurs.</p>
        </Card>
        <Card name="Email and SMS" badge="Not built — Milestone 2" tone="neutral">
          <p>No messages are sent by the system yet (confirmations, invitations, receipts). Marketing consent is already recorded separately from operational notices.</p>
        </Card>
      </div>
    </>
  );
}
