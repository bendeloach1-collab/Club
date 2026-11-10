import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, eyebrow, description, actions }: { title: string; eyebrow?: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold text-ink-950 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const tones = {
  neutral: "bg-ink-900/8 text-ink-800",
  green: "bg-emerald-100 text-emerald-900",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-900",
  blue: "bg-sky-100 text-sky-900",
  brass: "bg-brass-100 text-brass-700",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tones[tone]}`}>{children}</span>;
}

const statusTone: Record<string, Tone> = {
  active: "green", confirmed: "green", succeeded: "green", allowed: "green", won: "green", completed: "green", attended: "green", processed: "green",
  pending_payment: "amber", pending: "amber", processing: "amber", requires_action: "amber", frozen: "blue", scheduled: "blue", tour_scheduled: "blue", unconfigured: "amber", unavailable: "amber", partially_refunded: "amber", received: "amber",
  cancelled: "red", canceled: "red", failed: "red", denied: "red", lost: "red", no_show: "red", expired: "neutral", refunded: "neutral", disabled: "neutral", ignored: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"}>{status.replaceAll("_", " ")}</Badge>;
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "success" | "error" | "warning"; title?: string; children?: ReactNode }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-950",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    error: "border-red-200 bg-red-50 text-red-950",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 bg-white/60 px-6 py-10 text-center">
      <p className="font-semibold text-ink-900">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Marks anything that leaves AAC for a partner's site. */
export function ExternalIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M11 4h5v5M16 4l-7 7M8 5H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SandboxBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
      {children ?? "DEMO ENVIRONMENT — synthetic data and SANDBOX payments. No real charges are made."}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-950">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export function Pager({ basePath, page, hasMore, params = {} }: { basePath: string; page: number; hasMore: boolean; params?: Record<string, string | undefined> }) {
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q}`;
  };
  if (page <= 1 && !hasMore) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
      {page > 1 ? <Link className="btn btn-secondary btn-sm" href={href(page - 1)}>Previous</Link> : <span />}
      <span className="text-ink-500">Page {page}</span>
      {hasMore ? <Link className="btn btn-secondary btn-sm" href={href(page + 1)}>Next</Link> : <span />}
    </nav>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`flex items-center gap-2 font-semibold tracking-wide ${light ? "text-white" : "text-ink-950"}`}>
      <span className="grid h-8 w-8 place-items-center rounded-full bg-brass-600 text-xs font-bold text-white" aria-hidden="true">AAC</span>
      <span className="text-sm uppercase tracking-[0.14em]">Athens Athletic Club</span>
    </span>
  );
}
