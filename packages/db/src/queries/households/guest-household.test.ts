import { describe, expect, it } from "vitest";
import { createGuestHouseholdReader } from "./guest-household";
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
});
