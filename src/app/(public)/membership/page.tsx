import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { listPublicPlans } from "@/modules/membership/plans";

export const metadata: Metadata = { title: "Membership" };
export const dynamic = "force-dynamic";

export default async function MembershipPage() {
  const plans = await listPublicPlans();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader eyebrow="Membership" title="Choose your membership" description="Dues are billed each period by the club. The price you accept at enrollment is recorded with your agreement." />
      {plans.length === 0 ? (
        <EmptyState title="Membership plans are being updated" action={<Link href="/inquire" className="btn btn-primary">Contact us</Link>}>Please get in touch and we will help you join.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="card flex flex-col">
              <h2 className="text-xl font-semibold">{p.name}</h2>
              <p className="mt-1 text-sm text-ink-500">{p.description}</p>
              <p className="mt-4 text-3xl font-semibold text-ink-950">{formatMoney(p.duesCents, p.currency)}<span className="text-sm font-normal text-ink-500"> / {p.billingInterval}</span></p>
              <p className="text-xs text-ink-500">{p.enrollmentFeeCents > 0 ? `One-time enrollment fee ${formatMoney(p.enrollmentFeeCents, p.currency)}` : "No enrollment fee"}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {p.benefits.map((b) => (
                  <li key={b} className="flex gap-2"><span className="text-brass-600" aria-hidden="true">✓</span>{b}</li>
                ))}
              </ul>
              <Link href={`/join?plan=${p.code}`} className="btn btn-primary mt-5">Join — {p.name}</Link>
            </div>
          ))}
        </div>
      )}
      <p className="mt-6 text-sm text-ink-500">Corporate memberships are arranged through your employer. <Link className="font-semibold text-brass-700 hover:underline" href="/inquire?interest=corporate">Ask about corporate plans</Link>.</p>
    </div>
  );
}
