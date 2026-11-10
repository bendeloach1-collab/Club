import Link from "next/link";
import { eq } from "drizzle-orm";
import { logoutAction } from "@/app/(public)/login/actions";
import { StaffNav } from "@/components/staff-nav";
import { Logo, SandboxBanner } from "@/components/ui";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireStaffPage } from "@/lib/session";
import { getPaymentProvider } from "@/modules/billing/providers";
import { can, type Capability } from "@/modules/identity/actor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff console", robots: { index: false } };

const NAV: { href: string; label: string; cap?: Capability }[] = [
  { href: "/staff", label: "Today" },
  { href: "/staff/checkin", label: "Check-in", cap: "checkin.perform" },
  { href: "/staff/leads", label: "Leads & tours", cap: "crm.manage" },
  { href: "/staff/members", label: "Members", cap: "members.view" },
  { href: "/staff/schedule", label: "Schedule", cap: "schedule.view" },
  { href: "/staff/billing", label: "Billing", cap: "billing.view" },
  { href: "/staff/reports", label: "Reports", cap: "reports.view" },
  { href: "/staff/partners", label: "Partner services", cap: "partners.manage" },
  { href: "/staff/integrations", label: "Integrations", cap: "integrations.manage" },
  { href: "/staff/audit", label: "Audit log", cap: "audit.view" },
];

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaffPage();
  const [me] = await db.select({ name: user.name }).from(user).where(eq(user.id, actor.userId));
  // Navigation only reflects capabilities; each page and action enforces them again on the server.
  const items = NAV.filter((n) => !n.cap || can(actor, n.cap));
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="bg-ink-950 lg:min-h-dvh">
        <div className="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
          <Link href="/staff" aria-label="Staff console home"><Logo light /></Link>
        </div>
        <StaffNav items={items} />
        <div className="hidden border-t border-ink-800 px-4 py-3 text-xs text-ink-300 lg:block">
          <p className="font-semibold text-white">{me?.name}</p>
          <p className="capitalize">{actor.roles.join(", ").replaceAll("_", " ")}</p>
          <form action={logoutAction}><button className="mt-2 underline hover:text-white">Sign out</button></form>
        </div>
      </aside>
      <div className="min-w-0">
        {getPaymentProvider().isSandbox ? <SandboxBanner /> : null}
        <div className="flex items-center justify-between border-b border-line bg-white px-4 py-2 text-xs text-ink-500 lg:hidden">
          <span>{me?.name} · {actor.roles.join(", ").replaceAll("_", " ")}</span>
          <form action={logoutAction}><button className="underline">Sign out</button></form>
        </div>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
