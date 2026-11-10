"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/portal", label: "Home", icon: "M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1v-6.5Z" },
  { href: "/portal/book", label: "Book", icon: "M10 4v12M4 10h12" },
  { href: "/portal/schedule", label: "My Schedule", icon: "M5 3v3M15 3v3M3.5 8h13M4 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" },
  { href: "/portal/family", label: "Family", icon: "M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm7 1a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM2.5 16c.3-2.5 2.2-4 4.5-4s4.2 1.5 4.5 4M12 13c2.5-.6 5 .8 5.5 3" },
  { href: "/portal/services", label: "Services", icon: "M4 4h5v5H4V4Zm7 0h5v5h-5V4ZM4 11h5v5H4v-5Zm7 0h5v5h-5v-5Z" },
  { href: "/portal/account", label: "Account", icon: "M3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5v-7ZM3 8.5h14M6 12h3" },
];

/** Top navigation on desktop, bottom tab bar on phones. */
export function PortalNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/portal" ? path === "/portal" : path.startsWith(href));
  return (
    <>
      <nav aria-label="Member" className="hidden items-center gap-1 md:flex">
        {items.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={`rounded-md px-3 py-2 text-sm font-medium ${active(i.href) ? "bg-ink-800 text-white" : "text-ink-300 hover:text-white"}`}>{i.label}</Link>
        ))}
      </nav>
      <nav aria-label="Member" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.65rem] font-medium ${active(i.href) ? "text-brass-700" : "text-ink-500"}`}>
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={i.icon} /></svg>
            {i.label.replace("My ", "")}
          </Link>
        ))}
      </nav>
    </>
  );
}
