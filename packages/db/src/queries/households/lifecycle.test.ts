import { describe, expect, it } from "vitest";
import { createInMemoryHouseholdStore } from "./in-memory-store";
import { createHouseholdLifecycle } from "./lifecycle";

const OWNER = "owner-user";
const MEMBER = "member-user";
const OTHER_MEMBER = "other-member-user";

function setup() {
  const store = createInMemoryHouseholdStore();
  const lifecycle = createHouseholdLifecycle(store);
  return { lifecycle, store };
}

describe("household membership lifecycle", () => {
  it("creates a household workspace with an active owner membership", async () => {
    const { lifecycle, store } = setup();

    const { household, ownerMembership } = await lifecycle.createHousehold({
      ownerUserId: OWNER,
      name: "Home",
    });

    expect(household.ownerUserId).toBe(OWNER);
    expect(household.defaultScope).toBe("private");
    expect(ownerMembership).toMatchObject({
      householdId: household.id,
      userId: OWNER,
      role: "owner",
      status: "active",
    });
    expect(await lifecycle.listActiveMembershipsForUser({ userId: OWNER })).toHaveLength(1);
    expect(
      (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action),
    ).toEqual(["household.create"]);
  });

  it("does not allow multiple household workspaces for one owner in Phase 4", async () => {
    const { lifecycle } = setup();

    await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });

    await expect(
      lifecycle.createHousehold({ ownerUserId: OWNER, name: "Second home" }),
    ).rejects.toThrow("A household workspace already exists for this owner.");
  });

  it("requires invite acceptance before a member becomes active", async () => {
    const { lifecycle, store } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });

    const invited = await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });

    expect(invited).toMatchObject({ role: "member", status: "invited", acceptedAt: null });
    expect(await lifecycle.listActiveMembershipsForUser({ userId: MEMBER })).toEqual([]);

    const accepted = await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });

    expect(accepted.status).toBe("active");
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(await lifecycle.listActiveMembershipsForUser({ userId: MEMBER })).toHaveLength(1);
    expect(
      (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action),
    ).toEqual(["household.create", "household.member_invite", "household.member_accept"]);
  });

  it("lets owners invite multiple members and keeps roles limited to owner/member", async () => {
    const { lifecycle } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });

    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: OTHER_MEMBER,
    });

    const members = await lifecycle.listMembers({ ownerUserId: OWNER, householdId: household.id });

    expect(members.map((member) => member.role).sort()).toEqual(["member", "member", "owner"]);
    expect(new Set(members.map((member) => member.role))).toEqual(new Set(["owner", "member"]));
  });

  it("blocks members from managing invitations", async () => {
    const { lifecycle } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });

    await expect(
      lifecycle.inviteMember({
        ownerUserId: MEMBER,
        householdId: household.id,
        invitedUserId: OTHER_MEMBER,
      }),
    ).rejects.toThrow("Household owner permissions required.");
  });

  it("removes a member without deleting their membership history", async () => {
    const { lifecycle, store } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });

    const removed = await lifecycle.removeMember({
      ownerUserId: OWNER,
      householdId: household.id,
      memberUserId: MEMBER,
    });

    expect(removed.status).toBe("removed");
    expect(removed.removedAt).toBeInstanceOf(Date);
    expect(await lifecycle.listActiveMembershipsForUser({ userId: MEMBER })).toEqual([]);
    expect(
      await store.getHouseholdMembership({ householdId: household.id, userId: MEMBER }),
    ).toMatchObject({ id: removed.id, status: "removed" });
    expect(
      (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action),
    ).toContain("household.member_remove");
  });

  it("does not introduce owner access to another member's private records", async () => {
    const { lifecycle } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });

    // The membership service exposes membership lifecycle only. Private record
    // reads still require their owning user id and are enforced in later policy seams.
    expect(Object.keys(lifecycle).sort()).not.toContain("listPrivateRecordsForMember");
  });
});
