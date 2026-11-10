import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { InquiryForm } from "../lead-form";

export const metadata: Metadata = { title: "Contact membership" };

export default async function InquirePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <PageHeader eyebrow="Inquiries" title="Talk to our membership team" description="Tell us a little about what you're looking for. We reply within one business day." />
      <InquiryForm attribution={{ utm_source: sp.utm_source, utm_medium: sp.utm_medium, utm_campaign: sp.utm_campaign, interest: sp.interest }} />
    </div>
  );
}
