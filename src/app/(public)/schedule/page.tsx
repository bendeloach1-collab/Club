import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ScheduleList, WeekNav, weekRange, weekWindow } from "@/components/schedule-list";
import { listSessions } from "@/modules/booking/engine";

export const metadata: Metadata = { title: "Class schedule" };
export const dynamic = "force-dynamic";

export default async function PublicSchedulePage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start, endExclusive } = weekRange((await searchParams).start);
  const items = await listSessions(weekWindow(start, endExclusive));
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader eyebrow="Schedule" title="Classes and training" description="Members book in the club portal. All times are Eastern Time." />
      <WeekNav basePath="/schedule" start={start} />
      <ScheduleList items={items} hrefFor={(i) => `/portal/book/${i.sessionId}`} cta="Book" />
    </div>
  );
}
