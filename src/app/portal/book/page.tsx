import Link from "next/link";
import { ScheduleList, WeekNav, weekRange, weekWindow } from "@/components/schedule-list";
import { ExternalIcon, PageHeader } from "@/components/ui";
import { listServices, listSessions } from "@/modules/booking/engine";

const CATEGORIES = [["", "All"], ["class", "Classes"], ["performance", "Performance"]] as const;

export default async function BookPage({ searchParams }: { searchParams: Promise<{ start?: string; category?: string }> }) {
  const sp = await searchParams;
  const { start, endExclusive } = weekRange(sp.start);
  const category = CATEGORIES.some(([c]) => c === sp.category) ? sp.category : "";
  const [items, services] = await Promise.all([listSessions({ ...weekWindow(start, endExclusive), category: category || undefined }), listServices()]);
  const partnerManaged = services.filter((s) => s.service.bookingMode === "partner" && s.partnerSlug);
  return (
    <>
      <PageHeader eyebrow="Book" title="Classes and training" description="Bookings made here are confirmed by AAC. All times are Eastern Time." />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by type">
        {CATEGORIES.map(([c, label]) => (
          <Link key={c} href={`/portal/book?start=${start}${c ? `&category=${c}` : ""}`} aria-current={category === c ? "true" : undefined} className={`btn btn-sm ${category === c ? "btn-primary" : "btn-secondary"}`}>{label}</Link>
        ))}
      </div>
      <WeekNav basePath="/portal/book" start={start} extra={category ? `&category=${category}` : ""} />
      <ScheduleList items={items} hrefFor={(i) => `/portal/book/${i.sessionId}`} />
      {partnerManaged.length > 0 ? (
        <section className="mt-10" aria-labelledby="partner-booked">
          <h2 id="partner-booked" className="text-lg font-semibold">Booked with our partners</h2>
          <p className="mb-3 text-sm text-ink-500">These services are scheduled on the partner&apos;s own website. They won&apos;t appear in My Schedule.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {partnerManaged.map((s) => (
              <li key={s.service.id} className="card flex items-center justify-between gap-3 !p-4">
                <div><p className="font-semibold">{s.service.name}</p><p className="text-xs text-ink-500">{s.service.description}</p></div>
                <Link href={`/portal/services/${s.partnerSlug}`} className="btn btn-secondary btn-sm shrink-0">Details <ExternalIcon /></Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
