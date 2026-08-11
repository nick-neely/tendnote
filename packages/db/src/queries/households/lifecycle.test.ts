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

  it("records the creator's starting role as household provenance", async () => {
    const { lifecycle, store } = setup();

    const { household, ownerMembership } = await lifecycle.createHousehold({
      ownerUserId: OWNER,
      name: "  Home  ",
    });

    expect(household.name).toBe("Home");
    const [entry] = await store.listAuditLogEntries({ ownerUserId: OWNER });
    expect(entry).toMatchObject({
      action: "household.create",
      entityType: "household",
      entityId: household.id,
      metadataJson: {
        ownerMembershipId: ownerMembership.id,
        name: "Home",
        role: "owner",
        status: "active",
      },
    });
  });

  it("asks for a household name instead of creating an unnamed workspace", async () => {
    const { lifecycle } = setup();

    await expect(lifecycle.createHousehold({ ownerUserId: OWNER, name: "   " })).rejects.toThrow(
      "Give the household a name.",
    );
    expect(await lifecycle.listActiveMembershipsForUser({ userId: OWNER })).toEqual([]);
  });

  /**
   * Admission is decided by the creator's own active memberships, not by the
   * creator index: a user who joined someone else's household owns no workspace
   * row, and must still be refused a second active one.
   */
  it("refuses a second active workspace and explains the conflict privately", async () => {
    const { lifecycle } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });

    for (const userId of [OWNER, MEMBER]) {
      const rejection = lifecycle.createHousehold({ ownerUserId: userId, name: "Second home" });
      await expect(rejection).rejects.toThrow(
        "You're already in a household. Tendnote keeps you in one household at a time, so nothing here has changed.",
      );
      await expect(rejection).rejects.not.toThrow(household.id);
      expect(await lifecycle.listActiveMembershipsForUser({ userId })).toEqual([
        expect.objectContaining({ householdId: household.id }),
      ]);
    }
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

  it("persists selected-member record shares only for active household members", async () => {
    const { lifecycle, store } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });

    const shares = await lifecycle.shareRecordWithSelectedMembers({
      actorUserId: OWNER,
      householdId: household.id,
      recordKind: "memory",
      recordId: "00000000-0000-4000-8000-000000000001",
      selectedUserIds: [MEMBER],
    });

    expect(shares).toHaveLength(1);
    expect(
      await store.listHouseholdRecordShares({
        householdId: household.id,
        recordKind: "memory",
        recordId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject([{ sharedWithUserId: MEMBER, sharedByUserId: OWNER }]);
    expect(
      (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action),
    ).toContain("household.record_share");

    await expect(
      lifecycle.shareRecordWithSelectedMembers({
        actorUserId: OWNER,
        householdId: household.id,
        recordKind: "memory",
        recordId: "00000000-0000-4000-8000-000000000002",
        selectedUserIds: [OTHER_MEMBER],
      }),
    ).rejects.toThrow("Selected household members must be active.");
  });

  it("replaces the audience on re-selection rather than adding to it", async () => {
    // A narrowing that only ever grows the audience is a narrowing that never
    // happens. The per-domain audience changes clear their stale shares before
    // writing new ones; this generic seam has to do the same or a caller
    // reaching for it gets a fail-open version of the same operation (#180).
    const { lifecycle, store } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    for (const invitedUserId of [MEMBER, OTHER_MEMBER]) {
      await lifecycle.inviteMember({
        ownerUserId: OWNER,
        householdId: household.id,
        invitedUserId,
      });
      await lifecycle.acceptInvite({ householdId: household.id, userId: invitedUserId });
    }
    const record = {
      householdId: household.id,
      recordKind: "memory" as const,
      recordId: "00000000-0000-4000-8000-000000000009",
    };

    await lifecycle.shareRecordWithSelectedMembers({
      actorUserId: OWNER,
      ...record,
      selectedUserIds: [MEMBER, OTHER_MEMBER],
    });
    await lifecycle.shareRecordWithSelectedMembers({
      actorUserId: OWNER,
      ...record,
      selectedUserIds: [OTHER_MEMBER],
    });

    expect(await store.listHouseholdRecordShares(record)).toMatchObject([
      { sharedWithUserId: OTHER_MEMBER },
    ]);
    await expect(
      lifecycle.canViewHouseholdRecord({
        callerUserId: MEMBER,
        ownerUserId: OWNER,
        scope: "shared",
        ...record,
      }),
    ).resolves.toBe(false);
  });

  it("empties the audience when nobody is selected", async () => {
    const { lifecycle, store } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });
    const record = {
      householdId: household.id,
      recordKind: "memory" as const,
      recordId: "00000000-0000-4000-8000-00000000000a",
    };

    await lifecycle.shareRecordWithSelectedMembers({
      actorUserId: OWNER,
      ...record,
      selectedUserIds: [MEMBER],
    });
    await lifecycle.shareRecordWithSelectedMembers({
      actorUserId: OWNER,
      ...record,
      selectedUserIds: [],
    });

    expect(await store.listHouseholdRecordShares(record)).toEqual([]);
  });

  it("lets active members share records without household owner authority", async () => {
    const { lifecycle, store } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: OTHER_MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: OTHER_MEMBER });

    await lifecycle.shareRecordWithSelectedMembers({
      actorUserId: MEMBER,
      householdId: household.id,
      recordKind: "memory",
      recordId: "00000000-0000-4000-8000-000000000003",
      selectedUserIds: [OTHER_MEMBER],
    });

    expect(
      await store.listHouseholdRecordShares({
        householdId: household.id,
        recordKind: "memory",
        recordId: "00000000-0000-4000-8000-000000000003",
      }),
    ).toMatchObject([{ sharedWithUserId: OTHER_MEMBER, sharedByUserId: MEMBER }]);
  });

  it("checks selected-member visibility from persisted shares and active memberships", async () => {
    const { lifecycle } = setup();
    const { household } = await lifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await lifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: MEMBER,
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: MEMBER });

    await lifecycle.shareRecordWithSelectedMembers({
      actorUserId: OWNER,
      householdId: household.id,
      recordKind: "memory",
      recordId: "00000000-0000-4000-8000-000000000004",
      selectedUserIds: [MEMBER],
    });

    await expect(
      lifecycle.canViewHouseholdRecord({
        callerUserId: MEMBER,
        ownerUserId: OWNER,
        householdId: household.id,
        scope: "shared",
        recordKind: "memory",
        recordId: "00000000-0000-4000-8000-000000000004",
      }),
    ).resolves.toBe(true);
    await expect(
      lifecycle.canViewHouseholdRecord({
        callerUserId: OTHER_MEMBER,
        ownerUserId: OWNER,
        householdId: household.id,
        scope: "shared",
        recordKind: "memory",
        recordId: "00000000-0000-4000-8000-000000000004",
      }),
    ).resolves.toBe(false);
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
