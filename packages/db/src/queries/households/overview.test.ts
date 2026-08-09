import { describe, expect, it } from "vitest";
import { createInMemoryHouseholdStore } from "./in-memory-store";
import { createHouseholdLifecycle } from "./lifecycle";
import { createHouseholdOverviewReader, type HouseholdIdentityStore } from "./overview";

const IDENTITIES = [
  { id: "owner-user", name: "Alex", email: "alex@example.com" },
  { id: "member-user", name: "Sam", email: "sam@example.com" },
  { id: "outsider-user", name: "Jo", email: "jo@example.com" },
];

function identityStore(): HouseholdIdentityStore {
  return {
    async listUserIdentities({ userIds }) {
      return IDENTITIES.filter((identity) => userIds.includes(identity.id));
    },
  };
}

function setup() {
  const store = createInMemoryHouseholdStore();
  return {
    lifecycle: createHouseholdLifecycle(store),
    getHouseholdOverviewForUser: createHouseholdOverviewReader(store, identityStore()),
  };
}

describe("household overview read", () => {
  it("has nothing to describe before a household exists", async () => {
    const { getHouseholdOverviewForUser } = setup();

    expect(await getHouseholdOverviewForUser({ userId: "owner-user" })).toBeNull();
  });

  it("describes the creator as the household's sole active owner", async () => {
    const { lifecycle, getHouseholdOverviewForUser } = setup();
    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "The Neely house",
    });

    expect(await getHouseholdOverviewForUser({ userId: "owner-user" })).toEqual({
      householdId: household.id,
      name: "The Neely house",
      viewerRole: "owner",
      isSoleMember: true,
      seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
      members: [
        {
          userId: "owner-user",
          name: "Alex",
          email: "alex@example.com",
          role: "owner",
          isViewer: true,
        },
      ],
    });
  });

  it("keeps an invited-but-not-joined person out of the authorized membership state", async () => {
    const { lifecycle, getHouseholdOverviewForUser } = setup();
    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "The Neely house",
    });
    await lifecycle.inviteMember({
      ownerUserId: "owner-user",
      householdId: household.id,
      invitedUserId: "member-user",
    });

    const overview = await getHouseholdOverviewForUser({ userId: "owner-user" });

    expect(overview?.members.map((member) => member.userId)).toEqual(["owner-user"]);
    expect(overview?.seats.occupied).toBe(1);
    expect(await getHouseholdOverviewForUser({ userId: "member-user" })).toBeNull();
  });

  it("shows each member their own role in the same household", async () => {
    const { lifecycle, getHouseholdOverviewForUser } = setup();
    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "The Neely house",
    });
    await lifecycle.inviteMember({
      ownerUserId: "owner-user",
      householdId: household.id,
      invitedUserId: "member-user",
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: "member-user" });

    const ownerView = await getHouseholdOverviewForUser({ userId: "owner-user" });
    const memberView = await getHouseholdOverviewForUser({ userId: "member-user" });

    expect(ownerView?.viewerRole).toBe("owner");
    expect(memberView?.viewerRole).toBe("member");
    expect(memberView?.members.map((member) => member.name)).toEqual(["Sam", "Alex"]);
    expect(memberView?.isSoleMember).toBe(false);
    expect(memberView?.seats.occupied).toBe(2);
  });

  it("tells a user outside every household nothing about the ones that exist", async () => {
    const { lifecycle, getHouseholdOverviewForUser } = setup();
    await lifecycle.createHousehold({ ownerUserId: "owner-user", name: "The Neely house" });

    expect(await getHouseholdOverviewForUser({ userId: "outsider-user" })).toBeNull();
  });
});
