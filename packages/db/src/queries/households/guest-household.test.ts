import { describe, expect, it } from "vitest";
import { createGuestHouseholdReader, createGuestStandingReader } from "./guest-household";
import { seedHouseholdWithMembers } from "./household-fixtures";
import { createInMemoryHouseholdStore } from "./in-memory-store";

describe("guest household reader", () => {
  it("answers the account's household with only its active Owners", async () => {
    const store = createInMemoryHouseholdStore();
    const household = await seedHouseholdWithMembers(store, {
      ownerUserId: "owner-a",
      members: [
        ["owner-a", "owner"],
        ["owner-b", "owner"],
        ["guest-1", "member"],
      ],
    });
    const removed = await store.getHouseholdMembership({
      householdId: household.id,
      userId: "owner-b",
    });
    if (!removed) throw new Error("Missing seeded membership.");
    await store.updateHouseholdMembership({
      membershipId: removed.id,
      patch: { status: "removed", removedAt: new Date("2026-07-01T00:00:00Z") },
    });
    const read = createGuestHouseholdReader(store);

    await expect(read({ userId: "guest-1" })).resolves.toEqual({
      householdId: household.id,
      ownerUserIds: ["owner-a"],
    });
    await expect(read({ userId: "owner-b" })).resolves.toBeNull();
    await expect(read({ userId: "stranger" })).resolves.toBeNull();
  });

  describe("guest standing (#637)", () => {
    async function removeMembership(
      store: ReturnType<typeof createInMemoryHouseholdStore>,
      householdId: string,
      userId: string,
    ) {
      const membership = await store.getHouseholdMembership({ householdId, userId });
      if (!membership) throw new Error("Missing seeded membership.");
      await store.updateHouseholdMembership({
        membershipId: membership.id,
        patch: { status: "removed", removedAt: new Date("2026-07-01T00:00:00Z") },
      });
    }

    it("reads a kept membership as an inactive household and a removed one as ended", async () => {
      const store = createInMemoryHouseholdStore();
      const household = await seedHouseholdWithMembers(store, {
        ownerUserId: "owner-a",
        members: [
          ["owner-a", "owner"],
          ["guest-1", "member"],
          ["guest-2", "member"],
        ],
      });
      await removeMembership(store, household.id, "guest-2");
      const read = createGuestStandingReader(store);

      await expect(read({ userId: "guest-1" })).resolves.toBe("household_inactive");
      await expect(read({ userId: "guest-2" })).resolves.toBe("membership_ended");
      await expect(read({ userId: "stranger" })).resolves.toBeNull();
    });

    it("never reads an Owner as a guest of their own household", async () => {
      const store = createInMemoryHouseholdStore();
      await seedHouseholdWithMembers(store, {
        ownerUserId: "owner-a",
        members: [["owner-a", "owner"]],
      });

      await expect(createGuestStandingReader(store)({ userId: "owner-a" })).resolves.toBeNull();
    });

    it("prefers a membership the account holds now over one that ended", async () => {
      const store = createInMemoryHouseholdStore();
      const first = await seedHouseholdWithMembers(store, {
        ownerUserId: "owner-a",
        members: [
          ["owner-a", "owner"],
          ["guest-1", "member"],
        ],
      });
      await removeMembership(store, first.id, "guest-1");
      await seedHouseholdWithMembers(store, {
        ownerUserId: "owner-b",
        members: [
          ["owner-b", "owner"],
          ["guest-1", "member"],
        ],
      });

      await expect(createGuestStandingReader(store)({ userId: "guest-1" })).resolves.toBe(
        "household_inactive",
      );
    });
  });
});
