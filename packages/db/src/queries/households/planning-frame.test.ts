import { describe, expect, it } from "vitest";
import { createInMemoryHouseholdStore } from "./in-memory-store";
import { createHouseholdLifecycle } from "./lifecycle";
import type { HouseholdIdentityStore } from "./overview";
import { createHouseholdPlanningFrameReader } from "./planning-frame";

const IDENTITIES = [
  { id: "owner-user", name: "  Alex  ", email: "alex@example.com" },
  { id: "member-user", name: null, email: "sam@example.com" },
  { id: "invited-user", name: "Jo", email: "jo@example.com" },
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
    store,
    lifecycle: createHouseholdLifecycle(store),
    read: createHouseholdPlanningFrameReader(store, identityStore()),
  };
}

describe("Household planning frame", () => {
  it("returns nothing for a caller without an active Household", async () => {
    const { read } = setup();

    expect(await read({ userId: "outsider-user" })).toBeNull();
  });

  it("describes only the admitted planning frame and derives role from the caller's membership", async () => {
    const { lifecycle, read } = setup();
    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "Ash Lane",
    });
    await lifecycle.inviteMember({
      ownerUserId: "owner-user",
      householdId: household.id,
      invitedUserId: "member-user",
    });
    await lifecycle.acceptInvite({ userId: "member-user", householdId: household.id });
    await lifecycle.inviteMember({
      ownerUserId: "owner-user",
      householdId: household.id,
      invitedUserId: "invited-user",
    });

    expect(await read({ userId: "member-user" })).toEqual({
      householdId: household.id,
      name: "Ash Lane",
      viewerRole: "member",
      members: [
        { userId: "owner-user", name: "Alex" },
        { userId: "member-user", name: "sam@example.com" },
      ],
    });
  });

  it("fails closed when the workspace is dissolved even if an active membership row remains", async () => {
    const { lifecycle, read, store } = setup();
    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "Ash Lane",
    });
    await store.updateHouseholdWorkspace({
      householdId: household.id,
      patch: { status: "dissolved", dissolvedAt: new Date("2026-08-12T12:00:00Z") },
    });

    expect(await read({ userId: "owner-user" })).toBeNull();
  });
});
