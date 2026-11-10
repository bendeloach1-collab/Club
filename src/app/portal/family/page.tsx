import { Badge, PageHeader } from "@/components/ui";
import { requireMemberPage } from "@/lib/session";
import { clubDate, formatDateOnly } from "@/lib/time";
import { getHouseholdOverview } from "@/modules/identity/households";
import { ageOn } from "@/modules/identity/people";
import { AdultLoginForm, PermissionsForm } from "./forms";

export default async function FamilyPage() {
  const actor = await requireMemberPage();
  const householdId = actor.householdIds[0]!;
  const o = await getHouseholdOverview(actor, householdId);
  const me = o.members.find((m) => m.personId === actor.personId)!;
  const isPrimary = me.role === "primary";
  const today = clubDate();
  return (
    <>
      <PageHeader eyebrow="Family" title={o.household.name} description="Everyone on your membership. Booking, billing and charging permissions are granted individually by the primary member." />
      <ul className="grid gap-4 md:grid-cols-2">
        {o.members.map((m) => {
          const guardians = o.guardianships.filter((g) => g.childPersonId === m.personId);
          return (
            <li key={m.personId} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{m.firstName} {m.lastName}{m.personId === actor.personId ? <span className="ml-2 text-sm font-normal text-ink-500">(you)</span> : null}</h2>
                  <p className="text-xs text-ink-500">Member ID <span className="font-mono">{m.memberNumber}</span>{m.dateOfBirth ? ` · age ${ageOn(m.dateOfBirth, today)}` : ""}</p>
                </div>
                <div className="flex gap-1.5"><Badge tone={m.role === "primary" ? "brass" : "neutral"}>{m.role}</Badge>{m.role !== "dependent" ? <Badge tone={m.hasLogin ? "green" : "neutral"}>{m.hasLogin ? "Has login" : "No login"}</Badge> : null}</div>
              </div>
              {m.role === "dependent" ? (
                <p className="mt-3 border-t border-line pt-3 text-sm text-ink-500">
                  {guardians.length > 0
                    ? guardians.map((g) => { const gp = o.members.find((x) => x.personId === g.guardianPersonId); return `Guardian: ${gp?.firstName ?? "—"} (${g.verifiedAt ? `verified ${formatDateOnly(clubDate(g.verifiedAt))}` : "awaiting staff verification"})`; }).join("; ")
                    : "No guardian recorded. Please see the front desk."}
                </p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                  <li><Badge tone={m.canBookForHousehold ? "green" : "neutral"}>{m.canBookForHousehold ? "Can book for family" : "Books for self only"}</Badge></li>
                  <li><Badge tone={m.canManageBilling ? "green" : "neutral"}>{m.canManageBilling ? "Billing access" : "No billing access"}</Badge></li>
                  <li><Badge tone={m.canChargeAccount ? "green" : "neutral"}>{m.canChargeAccount ? `Can charge to account${m.chargeLimitCents !== null ? ` (≤ $${(m.chargeLimitCents / 100).toFixed(2)})` : ""}` : "Cannot charge to account"}</Badge></li>
                </ul>
              )}
              {isPrimary && m.role === "adult" ? <PermissionsForm p={{ householdId, ...m }} /> : null}
              {isPrimary && m.role === "adult" && !m.hasLogin ? <AdultLoginForm householdId={householdId} personId={m.personId} firstName={m.firstName} /> : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm text-ink-500">To add or remove household members, or to change guardianship, please contact the front desk. Kids Club pickup authorisations arrive with Kids Club check-in.</p>
    </>
  );
}
