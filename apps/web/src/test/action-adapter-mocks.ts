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

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathSpy,
  updateTag: updateTagSpy,
}));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwnerForAction: requireAdmittedOwnerForActionSpy,
}));
vi.mock("@/lib/rate-limit/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit/guards")>()),
  enforceProductBudget: enforceProductBudgetSpy,
}));
