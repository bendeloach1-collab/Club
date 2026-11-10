import Link from "next/link";
import { Alert, Badge, ExternalIcon } from "@/components/ui";
import type { PartnerCard as Card } from "@/modules/partners/partners";

/**
 * Partner service card. Every launch control carries the external-service indicator and
 * names the destination site; nothing here implies an AAC-confirmed appointment.
 */
export function PartnerActions({ card, size = "" }: { card: Card; size?: string }) {
  if (!card.available) return <Alert tone="warning" title="Not available online right now">{card.unavailableReason}</Alert>;
  const newTab = card.launchTarget === "new_tab";
  return (
    <div className="flex flex-wrap gap-2">
      {card.actions.map((a, idx) => (
        <a
          key={a.kind}
          href={`/go/${card.slug}/${a.kind}`}
          {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noreferrer" })}
          className={`btn ${idx === 0 ? "btn-primary" : "btn-secondary"} ${size}`}
        >
          {a.label}
          <ExternalIcon />
          <span className="sr-only">(external partner site {a.host}{newTab ? ", opens in a new tab" : ""})</span>
        </a>
      ))}
    </div>
  );
}

export function PartnerCardView({ card, detailHref }: { card: Card; detailHref?: string }) {
  return (
    <article className="card flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {card.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- partner logos are admin-configured remote URLs
          <img src={card.logoUrl} alt="" className="h-10 w-10 rounded-md border border-line object-contain" referrerPolicy="no-referrer" />
        ) : (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brass-100 text-sm font-bold text-brass-700" aria-hidden="true">{card.name.slice(0, 1)}</span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink-950">{detailHref ? <Link href={detailHref} className="hover:underline">{card.name}</Link> : card.name}</h3>
          <p className="text-sm text-ink-500">{card.description}</p>
        </div>
        <Badge tone="blue"><ExternalIcon className="h-3 w-3" /> Partner</Badge>
      </div>
      <PartnerActions card={card} size="btn-sm" />
      {card.available && card.actions[0] ? <p className="text-xs text-ink-500">Opens {card.actions[0].host}. Managed by the partner — not an AAC booking.</p> : null}
    </article>
  );
}
