import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, bookings, householdMembers } from "@/db/schema";
import { listEntriesForHousehold } from "@/modules/billing/account";
import { refundPayment } from "@/modules/billing/payments";
import { bookSession, cancelBooking, createSessions, listHouseholdBookings, quoteBooking, sessionRoster } from "@/modules/booking/engine";
import { getLead, listLeads } from "@/modules/crm/leads";
import { can } from "@/modules/identity/actor";
import { createAdultLogin, getHouseholdOverview, searchMembers, updateHouseholdPermissions } from "@/modules/identity/households";
import { checkInMember, scheduleMembershipChange } from "@/modules/membership/lifecycle";
import { listPartnersAdmin, savePartner } from "@/modules/partners/partners";
import { bookArgs, ensureBase, makeHousehold, makeSession, makeStaff, uid } from "./helpers";

beforeAll(ensureBase);

describe("household isolation", () => {
  it("prevents a member from reading another household's records", async () => {
    const [a, b] = await Promise.all([makeHousehold(), makeHousehold()]);
    await expect(getHouseholdOverview(a.actor, a.householdId)).resolves.toBeTruthy();
    await expect(getHouseholdOverview(a.actor, b.householdId)).rejects.toMatchObject({ code: "not_found" });
    await expect(listEntriesForHousehold(a.actor, b.householdId)).rejects.toMatchObject({ code: "not_found" });
    const { session } = await makeSession();
    const { booking } = await bookSession(b.actor, bookArgs(b, session.id, 0, "included"));
    const mine = await listHouseholdBookings(a.actor);
    expect(mine.find((x) => x.booking.id === booking.id)).toBeUndefined();
  });

  it("prevents a member from modifying another household's records", async () => {
    const [a, b] = await Promise.all([makeHousehold({ chargeEnabled: true, creditLimitCents: 99999 }), makeHousehold({ chargeEnabled: true, creditLimitCents: 99999 })]);
    const { session } = await makeSession({ priceCents: 1000 });
    const { booking } = await bookSession(b.actor, bookArgs(b, session.id, 1000, "club_account"));
    await expect(cancelBooking(a.actor, booking.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]!.status).toBe("confirmed");
    // Cannot book (or even quote) for a person in another household, nor charge their account.
    await expect(quoteBooking(a.actor, session.id, b.childId)).rejects.toMatchObject({ code: "not_found" });
    await expect(bookSession(a.actor, bookArgs(a, session.id, 1000, "club_account", b.actor.personId))).rejects.toMatchObject({ code: "not_found" });
    const perms = { householdId: b.householdId, personId: b.adultId, canBookForHousehold: true, canManageBilling: true, canChargeAccount: true, chargeLimitCents: null };
    await expect(updateHouseholdPermissions(a.actor, perms)).rejects.toMatchObject({ code: "not_found" });
    await expect(createAdultLogin(a.actor, { householdId: b.householdId, personId: b.adultId, email: `${uid()}@x.test`, password: "long-enough-password" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("requires the primary member to grant permissions, and records the change", async () => {
    const h = await makeHousehold();
    const perms = { householdId: h.householdId, personId: h.adultId, canBookForHousehold: true, canManageBilling: false, canChargeAccount: true, chargeLimitCents: 5000 };
    await updateHouseholdPermissions(h.actor, perms);
    const [row] = await db.select().from(householdMembers).where(eq(householdMembers.personId, h.adultId));
    expect(row).toMatchObject({ canBookForHousehold: true, canChargeAccount: true, chargeLimitCents: 5000, canManageBilling: false });
    await expect(updateHouseholdPermissions(h.actor, { ...perms, personId: h.childId })).rejects.toMatchObject({ code: "validation_error" });
    const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, h.adultId));
    expect(logs.some((l) => l.action === "permission.household_updated" && l.actorUserId === h.actor.userId)).toBe(true);
    // The second adult gets their own login but cannot escalate their own permissions.
    const userId = await createAdultLogin(h.actor, { householdId: h.householdId, personId: h.adultId, email: `${uid()}@adult.test`, password: "long-enough-password" });
    const { loadActor } = await import("@/modules/identity/actor");
    const adult = await loadActor(userId);
    await expect(updateHouseholdPermissions(adult, { ...perms, canManageBilling: true })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("members cannot use staff functions", () => {
  it("rejects every staff operation for a member", async () => {
    const h = await makeHousehold();
    const { session, service } = await makeSession();
    await expect(listLeads(h.actor, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(getLead(h.actor, uid())).rejects.toMatchObject({ code: "forbidden" });
    await expect(searchMembers(h.actor, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(sessionRoster(h.actor, session.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createSessions(h.actor, { serviceId: service.id, date: "2027-01-01", time: "09:00" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(checkInMember(h.actor, h.actor.personId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(scheduleMembershipChange(h.actor, { membershipId: h.membershipId, type: "cancel", effectiveDate: "2030-01-01" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(refundPayment(h.actor, uid(), 100, "x")).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPartnersAdmin(h.actor)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("staff roles see only what their role needs", () => {
  it("scopes capabilities by role", async () => {
    const [sales, desk, coach, finance, manager, admin] = await Promise.all([makeStaff("sales"), makeStaff("front_desk"), makeStaff("coach"), makeStaff("finance"), makeStaff("manager"), makeStaff("admin")]);
    const h = await makeHousehold();
    expect(can(sales, "crm.manage")).toBe(true);
    expect(can(desk, "crm.manage")).toBe(false);
    await expect(listLeads(desk, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(listEntriesForHousehold(desk, h.householdId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listEntriesForHousehold(sales, h.householdId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(listEntriesForHousehold(finance, h.householdId)).resolves.toBeTruthy();
    await expect(checkInMember(sales, h.actor.personId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(checkInMember(desk, h.actor.personId)).resolves.toMatchObject({ result: "allowed" });
    await expect(scheduleMembershipChange(finance, { membershipId: h.membershipId, type: "freeze", effectiveDate: "2020-01-01" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(savePartner(manager, { slug: "x-y", name: "X", category: "c", connectionMode: "link", approvedDomains: [], visibility: { audience: "members" }, launchTarget: "new_tab", status: "unconfigured" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPartnersAdmin(admin)).resolves.toBeTruthy();
    // A coach sees rosters only for sessions they lead.
    const { session } = await makeSession();
    await expect(sessionRoster(coach, session.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(sessionRoster(manager, session.id)).resolves.toBeTruthy();
  });

  it("denies check-in without an active membership and applies effective-dated changes", async () => {
    const [desk, manager] = await Promise.all([makeStaff("front_desk"), makeStaff("manager")]);
    const h = await makeHousehold();
    const future = await scheduleMembershipChange(manager, { membershipId: h.membershipId, type: "freeze", effectiveDate: "2099-01-01" });
    expect(future.applied).toBe(false);
    await expect(checkInMember(desk, h.actor.personId)).resolves.toMatchObject({ result: "allowed" });
    const { applyDueMembershipChanges } = await import("@/modules/membership/lifecycle");
    await applyDueMembershipChanges("2099-01-02");
    await expect(checkInMember(desk, h.actor.personId)).resolves.toMatchObject({ result: "denied" });
    const { session } = await makeSession();
    await expect(bookSession(h.actor, bookArgs(h, session.id, 0, "included"))).rejects.toMatchObject({ code: "forbidden" });
  });
});
