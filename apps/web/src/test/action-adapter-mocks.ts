import { vi } from "vitest";

/**
 * The module redirects every Action-mutation server-adapter test needs in place before the
 * adapter is imported: a session-resolved owner, Next's cache primitives, and the Action
 * invalidation seam. Importing this module registers all three — so import it above the
 * adapter under test, and assert on the spies it exports:
 *
 *   import { revalidatePathSpy } from "@/test/action-adapter-mocks";
 *   import { promoteSavedItemToGeneralActionAction } from "./saved-items";
 *
 * `requireAdmittedOwnerForAction` always resolves the same owner and takes no input, which
 * is what lets a test prove an adapter derived the owner from the session rather than from
 * its own arguments. The spies are named apart from the functions they stand in for so a
 * test never reads as if it were calling the real cache or invalidation seam.
 */

const OWNER_USER_ID = "owner-1";

export const revalidatePathSpy = vi.fn();
export const updateTagSpy = vi.fn();
export const enforceProductBudgetSpy = vi.fn();
export const requireAdmittedOwnerForActionSpy = vi.fn().mockResolvedValue(OWNER_USER_ID);
export const admittedOwnerOrNullSpy = vi.fn().mockResolvedValue(OWNER_USER_ID);
/**
 * For adapters that need the session's proven *identity* rather than just an
 * owner id — the Household Invitation acceptance path has to compare the
 * session's email against the invited address.
 */
export const getCurrentAccessSpy = vi.fn().mockResolvedValue({
  state: "admitted",
  ownerUserId: OWNER_USER_ID,
  user: { id: OWNER_USER_ID, email: "owner@example.com", name: "Owner" },
  decision: { admitted: true },
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathSpy,
  updateTag: updateTagSpy,
}));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwnerForAction: requireAdmittedOwnerForActionSpy,
  admittedOwnerOrNull: admittedOwnerOrNullSpy,
  getCurrentAccess: getCurrentAccessSpy,
}));
vi.mock("@/lib/rate-limit/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit/guards")>()),
  enforceProductBudget: enforceProductBudgetSpy,
}));
