import { describe, expect, it, vi } from "vitest";
import { createDrizzleHouseholdInvitationStore } from "./drizzle-invitation-store";

describe("Drizzle Household Invitation transaction binding", () => {
  it("reads access profiles through the same executor handed to the transaction", async () => {
    const profile = { userId: "member-1", status: "granted", source: "household_invitation" };
    const limit = vi.fn(async () => [profile]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const tx = { select: vi.fn(() => ({ from })) };
    const transaction = vi.fn(async (callback: (executor: unknown) => unknown) => callback(tx));
    const store = createDrizzleHouseholdInvitationStore(() => ({ transaction }) as never);

    await expect(
      store.withTransaction((transactionStore) =>
        transactionStore.accessProfiles.getByUserId(profile.userId),
      ),
    ).resolves.toEqual(profile);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.select).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledOnce();
  });

  it("takes the recipient lock through the transaction executor", async () => {
    const row = { id: "member-1" };
    const forUpdate = vi.fn(async () => [row]);
    const limit = vi.fn(() => ({ for: forUpdate }));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const tx = { select: vi.fn(() => ({ from })) };
    const transaction = vi.fn(async (callback: (executor: unknown) => unknown) => callback(tx));
    const store = createDrizzleHouseholdInvitationStore(() => ({ transaction }) as never);

    await expect(
      store.withTransaction((transactionStore) => transactionStore.lockUser({ userId: row.id })),
    ).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.select).toHaveBeenCalledOnce();
    expect(forUpdate).toHaveBeenCalledWith("update");
  });
});
