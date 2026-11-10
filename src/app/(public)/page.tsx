import Link from "next/link";
import { ExternalIcon } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getActor } from "@/lib/session";
import { listPublicPlans } from "@/modules/membership/plans";
import { listPartnerCards } from "@/modules/partners/partners";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [plans, partners] = await Promise.all([listPublicPlans(), listPartnerCards(await getActor())]);
  const from = plans.length ? Math.min(...plans.map((p) => p.duesCents)) : null;
  return (
    <>
      <section className="bg-ink-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <p className="eyebrow !text-brass-500">Athens, Georgia</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">Train, play and recover under one roof.</h1>
          <p className="mt-4 max-w-xl text-base text-ink-300">Performance training, group classes, courts, golf simulators, Kids Club and on-site wellness partners — one membership for the whole household.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/membership" className="btn btn-accent">Become a member{from !== null ? ` · from ${formatMoney(from)}/mo` : ""}</Link>
            <Link href="/tour" className="btn border border-ink-500 text-white hover:bg-ink-800">Schedule a tour</Link>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Classes & performance", "Coach-led conditioning, yoga and small-group performance training.", "/schedule", "View schedule"],
            ["Membership for every household", "Individual, couple and family plans with a shared club account.", "/membership", "Compare plans"],
            ["Questions?", "Tell us what you're looking for and our team will follow up.", "/inquire", "Contact membership"],
          ].map(([title, body, href, cta]) => (
            <div key={title} className="card flex flex-col">
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-1 flex-1 text-sm text-ink-500">{body}</p>
              <Link href={href!} className="mt-4 text-sm font-semibold text-brass-700 hover:underline">{cta} →</Link>
            </div>
          ))}
        </div>
        {partners.length > 0 ? (
          <div className="mt-12">
            <p className="eyebrow">On-site partners</p>
            <h2 className="mt-1 text-2xl font-semibold">Services from trusted partners</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {partners.map((p) => (
                <div key={p.slug} className="card">
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="mt-1 text-sm text-ink-500">{p.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.actions.filter((a) => a.kind === "booking").map((a) => (
                      <a key={a.kind} href={`/go/${p.slug}/${a.kind}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                        {a.label} <ExternalIcon /><span className="sr-only">(opens partner website {a.host} in a new tab)</span>
                      </a>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-500">Provided and scheduled by an independent partner on their own website.</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
