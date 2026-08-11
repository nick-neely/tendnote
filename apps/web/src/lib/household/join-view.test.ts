import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  viewHouseholdInvitation: vi.fn(),
  listActiveHouseholdMembershipsForUser: vi.fn(),
}));
vi.mock("@tendnote/db/queries/households", () => db);

const { getCurrentAccess } = vi.hoisted(() => ({ getCurrentAccess: vi.fn() }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess }));

import { resolveHouseholdJoinView } from "./join-view";

const READY = {
  state: "ready",
  householdName: "The Neely house",
  role: "member",
  expiresAt: new Date("2026-08-15T09:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  db.listActiveHouseholdMembershipsForUser.mockResolvedValue([]);
  db.viewHouseholdInvitation.mockResolvedValue(READY);
});

describe("resolveHouseholdJoinView", () => {
  it("shows a signed-out visitor no viewer at all", async () => {
    getCurrentAccess.mockResolvedValue({ state: "unauthenticated" });
    db.viewHouseholdInvitation.mockResolvedValue({ state: "sign-in-required" });

    await expect(resolveHouseholdJoinView("secret")).resolves.toEqual({
      state: "sign-in-required",
    });
    expect(db.viewHouseholdInvitation).toHaveBeenCalledWith({ secret: "secret", viewer: null });
  });

  /**
   * Both states, one test, because "counted like anyone else's" is the whole
   * claim. A pending account can hold a membership now, so assuming it has none
   * would show a second invitation as ready and let the one-household rule
   * refuse it a press later.
   */
  it.each([
    "admitted",
    "pending",
  ] as const)("tells the lifecycle how many households a %s viewer already has", async (state) => {
    getCurrentAccess.mockResolvedValue({
      state,
      user: { id: "sam-1", email: "sam@example.com" },
    });
    db.listActiveHouseholdMembershipsForUser.mockResolvedValue([{ householdId: "other" }]);
    db.viewHouseholdInvitation.mockResolvedValue({ state: "workspace-conflict" });

    await expect(resolveHouseholdJoinView("secret")).resolves.toEqual({
      state: "workspace-conflict",
    });
    expect(db.viewHouseholdInvitation).toHaveBeenCalledWith({
      secret: "secret",
      viewer: { userId: "sam-1", email: "sam@example.com", activeHouseholds: 1 },
    });
  });

  it("says nothing about access on a decision that proved nothing", async () => {
    getCurrentAccess.mockResolvedValue({
      state: "admitted",
      user: { id: "sam-1", email: "sam@example.com" },
    });

    await expect(resolveHouseholdJoinView("secret")).resolves.toEqual({
      ...READY,
      accessPending: false,
    });
  });

  /**
   * Private Beta Access is a different gate from the invitation, so it is only
   * ever applied *after* the invited address has been proven. A pending visitor
   * holding someone else's link must still see the address mismatch, not a
   * signal that their own account exists and is waiting.
   */
  it("mentions pending access only once the invited address is proven", async () => {
    getCurrentAccess.mockResolvedValue({
      state: "pending",
      user: { id: "sam-1", email: "sam@example.com" },
    });

    await expect(resolveHouseholdJoinView("secret")).resolves.toEqual({
      ...READY,
      accessPending: true,
    });

    db.viewHouseholdInvitation.mockResolvedValue({ state: "address-mismatch" });
    await expect(resolveHouseholdJoinView("secret")).resolves.toEqual({
      state: "address-mismatch",
    });
  });
});
