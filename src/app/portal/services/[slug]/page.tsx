import Link from "next/link";
import { notFound } from "next/navigation";
import { PartnerActions } from "@/components/partner-card";
import { Alert, Badge, ExternalIcon, PageHeader } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { requireMemberPage } from "@/lib/session";
import { getPartnerCard, type PartnerCard } from "@/modules/partners/partners";

export default async function ServiceDetailPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireMemberPage();
  const { slug } = await params;
  let card: PartnerCard;
  try {
    card = await getPartnerCard(actor, slug);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Partner service" title={card.name} actions={<Badge tone="blue"><ExternalIcon className="h-3 w-3" /> External partner</Badge>} />
      {(await searchParams).notice === "unavailable" ? <div className="mb-4"><Alert tone="error" title="We couldn't open that partner page">Nothing was booked or charged. Please try again later or ask the front desk for help.</Alert></div> : null}
      <div className="card space-y-4">
        <p className="text-sm text-ink-800">{card.description}</p>
        <PartnerActions card={card} />
        {card.available ? (
          <ul className="space-y-1 text-xs text-ink-500">
            {card.actions.map((a) => <li key={a.kind}>“{a.label}” opens <span className="font-mono">{a.host}</span>{card.launchTarget === "new_tab" ? " in a new tab — return to this tab to come back to AAC." : " — use your browser's Back button to return to AAC."}</li>)}
          </ul>
        ) : null}
        <Alert tone="info" title="How this works">{card.connectionNote}</Alert>
      </div>
      <Link href="/portal/services" className="mt-4 inline-block text-sm font-semibold text-brass-700 hover:underline">← All services</Link>
    </div>
  );
}
