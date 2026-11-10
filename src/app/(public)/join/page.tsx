import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { formatMoney } from "@/lib/money";
import { getActor } from "@/lib/session";
import { currentDocuments, getPlanByCode } from "@/modules/membership/plans";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Join" };
export const dynamic = "force-dynamic";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan: code } = await searchParams;
  const plan = code ? await getPlanByCode(db, code) : null;
  if (!plan || !plan.isPublic || !plan.isActive) redirect("/membership");
  const actor = await getActor();
  const docs = await currentDocuments();
  const total = plan.duesCents + plan.enrollmentFeeCents;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader eyebrow="Enrollment" title={`Join — ${plan.name} membership`} description={<>Not the right plan? <Link className="font-semibold text-brass-700 hover:underline" href="/membership">Compare plans</Link>.</>} />
      <div className="card mb-6 grid gap-2 text-sm sm:grid-cols-3">
        <div><p className="text-ink-500">Dues</p><p className="font-semibold">{formatMoney(plan.duesCents, plan.currency)} / {plan.billingInterval}</p></div>
        <div><p className="text-ink-500">Enrollment fee</p><p className="font-semibold">{formatMoney(plan.enrollmentFeeCents, plan.currency)}</p></div>
        <div><p className="text-ink-500">Due today</p><p className="font-semibold">{formatMoney(total, plan.currency)}</p></div>
      </div>
      {actor ? (
        <Alert tone="info" title="You're already signed in">Each household holds one membership. <Link className="font-semibold underline" href="/portal">Go to your club portal</Link> to manage it.</Alert>
      ) : (
        <JoinForm plan={{ code: plan.code, name: plan.name, maxAdults: plan.maxAdults, maxDependents: plan.maxDependents }} idempotencyKey={randomUUID()} docs={docs.map((d) => ({ kind: d.kind, title: d.title, body: d.body, version: d.version }))} totalLabel={formatMoney(total, plan.currency)} />
      )}
    </div>
  );
}
