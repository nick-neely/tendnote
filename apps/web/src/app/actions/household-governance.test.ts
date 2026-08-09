import { HouseholdValidationError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy, updateTagSpy } from "@/test/action-adapter-mocks";

const db = vi.hoisted(() => ({
  offerHouseholdOwnerRole: vi.fn(),
  withdrawHouseholdOwnerOffer: vi.fn(),
  acceptHouseholdOwnerRole: vi.fn(),
  declineHouseholdOwnerRole: vi.fn(),
  stepDownFromHouseholdOwner: vi.fn(),
  removeHouseholdMember: vi.fn(),
  leaveHousehold: vi.fn(),
  confirmHouseholdDissolution: vi.fn(),
  cancelHouseholdDissolution: vi.fn(),
  getHouseholdOverviewForUser: vi.fn(),
}));

vi.mock("@tendnote/db/queries/households", () => db);

import {
  acceptHouseholdOwnerRoleAction,
  confirmHouseholdDissolutionAction,
  leaveHouseholdAction,
  offerHouseholdOwnerRoleAction,
  removeHouseholdMemberAction,
} from "./household-governance";

const OVERVIEW = {
  householdId: "household-1",
  name: "The Neely house",
  viewerRole: "owner" as const,
  isSoleMember: false,
  invitations: [],
  seats: { limit: 8, occupied: 2, remaining: 6, isFull: false },
  members: [],
  ownerOffer: null,
  departure: { available: true, blockedReason: null },
  stepDown: { available: true, blockedReason: null },
  dissolution: {
    available: true,
    blockedReason: null,
    required: 2,
    confirmed: 0,
    awaitingUserIds: ["owner-1", "owner-2"],
    unanimous: false,
    viewerHasConfirmed: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  db.getHouseholdOverviewForUser.mockResolvedValue(OVERVIEW);
});

describe("household governance actions", () => {
  /**
   * The caller's id comes from the session gate, never from the payload. A
   * governance action that accepted an actor would be an authority bypass with
   * extra steps.
   */
  it("takes the actor from the session and the target from the request", async () => {
    const result = await offerHouseholdOwnerRoleAction({ memberUserId: "member-2" });

    expect(result).toEqual({ ok: true, view: OVERVIEW });
    expect(db.offerHouseholdOwnerRole).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      memberUserId: "member-2",
    });
  });

  it("accepts a role for the caller alone, with nothing to point elsewhere", async () => {
    await acceptHouseholdOwnerRoleAction();

    expect(db.acceptHouseholdOwnerRole).toHaveBeenCalledWith({ userId: "owner-1" });
  });

  /** A governance move changes the whole Household view, so it invalidates it. */
  it("invalidates the account read model every move is visible in", async () => {
    await removeHouseholdMemberAction({ memberUserId: "member-2" });

    expect(db.removeHouseholdMember).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      memberUserId: "member-2",
    });
    expect(updateTagSpy).toHaveBeenCalled();
  });

  /**
   * The protected-co-owner rule is re-decided in the shared lifecycle, so a
   * stale client that still renders the control gets the curated sentence back
   * as data rather than a thrown error the surface has to guess at.
   */
  it("renders a governance refusal in place", async () => {
    db.removeHouseholdMember.mockRejectedValue(
      new HouseholdValidationError(
        "Owners can't remove another owner. They can step down or leave whenever they choose.",
      ),
    );

    const result = await removeHouseholdMemberAction({ memberUserId: "owner-2" });

    expect(result).toEqual({
      ok: false,
      error: "Owners can't remove another owner. They can step down or leave whenever they choose.",
    });
  });

  it("answers a departure with no household, because there is none left to read", async () => {
    db.getHouseholdOverviewForUser.mockResolvedValue(null);

    const result = await leaveHouseholdAction();

    expect(db.leaveHousehold).toHaveBeenCalledWith({ userId: "owner-1" });
    expect(result).toEqual({ ok: true, view: { view: null } });
  });

  it("carries the dissolution's own progress back, alongside whatever view remains", async () => {
    const dissolution = {
      required: 2,
      confirmed: 1,
      awaitingUserIds: ["owner-2"],
      unanimous: false,
      dissolved: null,
    };
    db.confirmHouseholdDissolution.mockResolvedValue(dissolution);

    const result = await confirmHouseholdDissolutionAction();

    expect(db.confirmHouseholdDissolution).toHaveBeenCalledWith({ ownerUserId: "owner-1" });
    expect(result).toEqual({ ok: true, view: { dissolution, view: OVERVIEW } });
  });
});
