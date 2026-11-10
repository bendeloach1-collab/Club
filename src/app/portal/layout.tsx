import Link from "next/link";
import { logoutAction } from "@/app/(public)/login/actions";
import { PortalNav } from "@/components/portal-nav";
import { Logo, SandboxBanner } from "@/components/ui";
import { requireMemberPage } from "@/lib/session";
import { getPaymentProvider } from "@/modules/billing/providers";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  await requireMemberPage();
  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      {getPaymentProvider().isSandbox ? <SandboxBanner /> : null}
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <Link href="/portal" aria-label="Member home"><Logo light /></Link>
          <PortalNav />
          <form action={logoutAction}><button className="rounded-md px-2 py-2 text-xs font-medium text-ink-300 hover:text-white">Sign out</button></form>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
