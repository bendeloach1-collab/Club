"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
      <div>
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-2 text-3xl font-semibold">We hit a problem loading this page</h1>
        <p className="mt-2 text-sm text-ink-500">Nothing was changed. Please try again{error.digest ? ` (reference ${error.digest})` : ""}.</p>
        <button onClick={reset} className="btn btn-primary mt-6">Try again</button>
      </div>
    </main>
  );
}
