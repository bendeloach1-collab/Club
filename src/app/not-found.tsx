import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
      <div>
        <p className="eyebrow">Not found</p>
        <h1 className="mt-2 text-3xl font-semibold">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-sm text-ink-500">It may have moved, or you may not have access to it.</p>
        <Link href="/" className="btn btn-primary mt-6">Back to home</Link>
      </div>
    </main>
  );
}
