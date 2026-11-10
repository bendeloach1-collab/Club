import Link from "next/link";
import { Logo, SandboxBanner } from "@/components/ui";
import { getPaymentProvider } from "@/modules/billing/providers";
import { getActor } from "@/lib/session";
import { isStaff } from "@/modules/identity/actor";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  const home = actor ? (isStaff(actor) ? "/staff" : "/portal") : "/login";
  return (
    <div className="flex min-h-dvh flex-col">
      {getPaymentProvider().isSandbox ? <SandboxBanner /> : null}
      <header className="border-b border-ink-800 bg-ink-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" aria-label="Athens Athletic Club home"><Logo light /></Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-medium text-ink-300">
            <Link className="hover:text-white" href="/membership">Membership</Link>
            <Link className="hover:text-white" href="/schedule">Schedule</Link>
            <Link className="hover:text-white" href="/tour">Book a Tour</Link>
            <Link className="rounded-md border border-ink-500 px-3 py-1.5 text-white hover:bg-ink-800" href={home}>{actor ? "My Club" : "Member Login"}</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 py-6 text-xs text-ink-500">
          <p>© Athens Athletic Club · Athens, Georgia · All times shown in Eastern Time.</p>
          <p className="flex gap-4"><Link href="/inquire" className="hover:text-ink-900">Contact</Link><Link href="/membership" className="hover:text-ink-900">Join</Link></p>
        </div>
      </footer>
    </div>
  );
}
