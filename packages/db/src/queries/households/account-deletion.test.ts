import { HOUSEHOLD_ACCOUNT_DELETION_REQUIRES_CO_OWNER } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createAccountDeletionHouseholdGuard } from "./account-deletion";

function guard(members: Array<{ userId: string; role: "owner" | "member" }> | null) {
  const getOverview = vi.fn().mockResolvedValue(members ? { members } : null);
  return { assertAllowed: createAccountDeletionHouseholdGuard(getOverview) };
}

describe("account deletion household guard", () => {
  it.each([
    ["no household", null],
    ["sole member", [{ userId: "ana", role: "owner" as const }]],
    [
      "another owner remains",
      [
        { userId: "ana", role: "owner" as const },
        { userId: "ben", role: "owner" as const },
      ],
    ],
  ])("allows %s without mutating governance", async (_name, members) => {
    const { assertAllowed } = guard(members);
    await expect(assertAllowed({ userId: "ana" })).resolves.toBeUndefined();
  });

  it("refuses the last owner of a multi-member household", async () => {
    const { assertAllowed } = guard([
      { userId: "ana", role: "owner" },
      { userId: "ben", role: "member" },
    ]);
    await expect(assertAllowed({ userId: "ana" })).rejects.toThrow(
      HOUSEHOLD_ACCOUNT_DELETION_REQUIRES_CO_OWNER,
    );
  });
});
