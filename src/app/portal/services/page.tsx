import Link from "next/link";
import { PartnerCardView } from "@/components/partner-card";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireMemberPage } from "@/lib/session";
import { listPartnerCards } from "@/modules/partners/partners";

export default async function ServicesPage() {
  const actor = await requireMemberPage();
  const cards = await listPartnerCards(actor);
  const categories = [...new Set(cards.map((c) => c.category))];
  return (
    <>
      <PageHeader eyebrow="Services" title="Club and partner services" description="Partner services open on the partner's own website. You stay signed in to AAC, and may need to sign in with the partner separately." />
      <div className="card mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Classes and performance training</h2><p className="text-sm text-ink-500">Booked and confirmed directly with AAC.</p></div>
        <Link href="/portal/book" className="btn btn-primary btn-sm">Book with AAC</Link>
      </div>
      {cards.length === 0 ? (
        <EmptyState title="No partner services are available for your membership yet">Check back soon, or ask the front desk about wellness and golf partners.</EmptyState>
      ) : (
        categories.map((cat) => (
          <section key={cat} className="mb-8" aria-label={cat}>
            <h2 className="mb-2 text-lg font-semibold capitalize">{cat.replaceAll("-", " ")}</h2>
            <div className="grid gap-4 md:grid-cols-2">{cards.filter((c) => c.category === cat).map((c) => <PartnerCardView key={c.slug} card={c} detailHref={`/portal/services/${c.slug}`} />)}</div>
          </section>
        ))
      )}
    </>
  );
}
