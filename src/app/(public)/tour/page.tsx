import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatClubLongDate, formatClubTime } from "@/lib/time";
import { availableTourSlots } from "@/modules/crm/leads";
import { TourForm } from "../lead-form";

export const metadata: Metadata = { title: "Book a tour" };
export const dynamic = "force-dynamic";

export default async function TourPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const slots = await availableTourSlots();
  const days = new Map<string, { iso: string; label: string }[]>();
  for (const s of slots) {
    const k = formatClubLongDate(s);
    days.set(k, [...(days.get(k) ?? []), { iso: s.toISOString(), label: formatClubTime(s) }]);
  }
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <PageHeader eyebrow="Visit the club" title="Schedule a tour" description="A 45-minute walk-through with a membership advisor. Tours are available Monday to Saturday." />
      {slots.length === 0 ? (
        <EmptyState title="No tour times are open online right now" action={<Link href="/inquire" className="btn btn-primary">Contact us</Link>}>Send us a note and we&apos;ll arrange a time that works for you.</EmptyState>
      ) : (
        <TourForm attribution={{ utm_source: sp.utm_source, utm_medium: sp.utm_medium, utm_campaign: sp.utm_campaign }} days={[...days].map(([label, s]) => ({ label, slots: s }))} />
      )}
    </div>
  );
}
