"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function StaffNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/staff" ? path === "/staff" : path.startsWith(href));
  return (
    <nav aria-label="Staff" className="flex gap-1 overflow-x-auto px-2 py-2 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${active(i.href) ? "bg-ink-800 text-white" : "text-ink-300 hover:bg-ink-900 hover:text-white"}`}>{i.label}</Link>
      ))}
    </nav>
  );
}
