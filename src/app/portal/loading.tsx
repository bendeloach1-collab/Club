export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 animate-pulse rounded bg-ink-900/10" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-ink-900/5" />
        ))}
      </div>
    </div>
  );
}
