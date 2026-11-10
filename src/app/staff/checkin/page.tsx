import { ActionForm } from "@/components/staff-form";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaffPage } from "@/lib/session";
import { searchMembers } from "@/modules/identity/households";
import { checkInAction } from "../actions";

export default async function CheckinPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireStaffPage("checkin.perform");
  const q = (await searchParams).q?.trim();
  const results = q ? await searchMembers(actor, { q, pageSize: 10 }) : null;
  return (
    <>
      <PageHeader eyebrow="Front desk" title="Member check-in" description="Scan or type the member ID from the digital card, or search by name. Access is decided from live membership status." />
      <form className="mb-6 flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Member ID or name</label>
        <input id="q" name="q" defaultValue={q} placeholder="AAC-100001 or last name" className="input max-w-sm text-lg" autoFocus autoComplete="off" />
        <button className="btn btn-primary">Find</button>
      </form>
      {results === null ? <EmptyState title="Ready to check in">Search for a member to begin.</EmptyState> : results.rows.length === 0 ? <EmptyState title="No member found">Check the ID or try the last name.</EmptyState> : (
        <ul className="space-y-3">
          {results.rows.map((r) => (
            <li key={`${r.personId}-${r.householdId}`} className="card flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-lg font-semibold">{r.firstName} {r.lastName}</p>
                <p className="text-sm text-ink-500"><span className="font-mono">{r.memberNumber}</span> · {r.role} · {r.membershipStatus ? <StatusBadge status={r.membershipStatus} /> : "no membership"}</p>
              </div>
              <ActionForm action={checkInAction} submitLabel="Check in" pendingLabel="Checking…" hidden={{ personId: r.personId }} buttonClass="btn btn-accent" className="flex flex-col items-end gap-2" resetOnSuccess={false} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
