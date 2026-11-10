import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { membershipPlans } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireStaffPage } from "@/lib/session";
import { getPartnerAdmin } from "@/modules/partners/partners";
import { PartnerForm, type PartnerFormValues } from "./partner-form";

const blank: PartnerFormValues = { slug: "", name: "", description: "", logoUrl: "", category: "wellness", connectionMode: "link", approvedDomains: "", bookingUrl: "", bookingLabel: "", accountUrl: "", accountLabel: "", supportUrl: "", deepLinkUrl: "", audience: "members", planCodes: [], launchTarget: "new_tab", status: "unconfigured", handlesHealthInfo: false, displayOrder: 10 };

export default async function PartnerEditPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage("partners.manage");
  const { id } = await params;
  let v = blank;
  if (id !== "new") {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    try {
      const p = await getPartnerAdmin(actor, id);
      v = { id: p.id, slug: p.slug, name: p.name, description: p.description, logoUrl: p.logoUrl ?? "", category: p.category, connectionMode: p.connectionMode, approvedDomains: p.approvedDomains.join("\n"), bookingUrl: p.bookingUrl ?? "", bookingLabel: p.bookingLabel ?? "", accountUrl: p.accountUrl ?? "", accountLabel: p.accountLabel ?? "", supportUrl: p.supportUrl ?? "", deepLinkUrl: p.deepLinkUrl ?? "", audience: p.visibility.audience, planCodes: p.visibility.planCodes ?? [], launchTarget: p.launchTarget, status: p.status, handlesHealthInfo: p.handlesHealthInfo, displayOrder: p.displayOrder };
    } catch (e) {
      if (e instanceof AppError && e.code === "not_found") notFound();
      throw e;
    }
  }
  const plans = await db.select({ code: membershipPlans.code, name: membershipPlans.name }).from(membershipPlans).orderBy(asc(membershipPlans.sortOrder));
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Partner services" title={id === "new" ? "Add partner service" : `Edit ${v.name}`} actions={<Link href="/staff/partners" className="btn btn-secondary btn-sm">← Directory</Link>} />
      <PartnerForm v={v} plans={plans} />
    </div>
  );
}
