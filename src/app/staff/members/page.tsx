import Link from "next/link";
import { EmptyState, PageHeader, Pager, StatusBadge } from "@/components/ui";
import { requireStaffPage } from "@/lib/session";
import { searchMembers } from "@/modules/identity/households";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const actor = await requireStaffPage("members.view");
  const sp = await searchParams;
  const list = await searchMembers(actor, { q: sp.q, page: Number(sp.page ?? 1) });
  return (
    <>
      <PageHeader eyebrow="Members" title="Member directory" />
      <form className="mb-4 flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Search members</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Name, email or member ID" className="input max-w-sm" />
        <button className="btn btn-secondary">Search</button>
      </form>
      {list.rows.length === 0 ? <EmptyState title="No members found">Try a last name, an exact email address, or a member ID such as AAC-100001.</EmptyState> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Members</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Member ID</th><th scope="col">Role</th><th scope="col">Membership</th></tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={`${r.personId}-${r.householdId}`}>
                  <td><Link className="font-semibold text-brass-700 hover:underline" href={`/staff/members/${r.householdId}`}>{r.lastName}, {r.firstName}</Link></td>
                  <td className="font-mono">{r.memberNumber}</td>
                  <td className="capitalize">{r.role}</td>
                  <td>{r.membershipStatus ? <StatusBadge status={r.membershipStatus} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager basePath="/staff/members" page={list.page} hasMore={list.hasMore} params={{ q: sp.q }} />
    </>
  );
}
