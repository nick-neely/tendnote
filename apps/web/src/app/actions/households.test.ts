import { HouseholdAdmissionConflictError, HouseholdValidationError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceProductBudgetSpy,
  requireAdmittedOwnerForActionSpy,
  updateTagSpy,
} from "@/test/action-adapter-mocks";

const { createHousehold, getHouseholdOverviewForUser } = vi.hoisted(() => ({
  createHousehold: vi.fn(),
  getHouseholdOverviewForUser: vi.fn(),
}));

vi.mock("@tendnote/db/queries/households", () => ({
  createHousehold,
  getHouseholdOverviewForUser,
}));

import { createHouseholdAction } from "./households";

const OVERVIEW = {
  householdId: "household-1",
  name: "The Neely house",
  viewerRole: "owner" as const,
  isSoleMember: true,
  seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
  members: [
    {
      userId: "owner-1",
      name: "Alex",
      email: "alex@example.com",
      role: "owner" as const,
      isViewer: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  createHousehold.mockResolvedValue({ household: { id: "household-1" } });
  getHouseholdOverviewForUser.mockResolvedValue(OVERVIEW);
});

describe("createHouseholdAction", () => {
  it("creates the household for the session owner and answers with their overview", async () => {
    await expect(createHouseholdAction({ name: "The Neely house" })).resolves.toEqual({
      ok: true,
      view: OVERVIEW,
    });

    expect(createHousehold).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      name: "The Neely house",
    });
    expect(getHouseholdOverviewForUser).toHaveBeenCalledWith({ userId: "owner-1" });
    expect(enforceProductBudgetSpy).toHaveBeenCalledWith({
      costCategory: "server-action",
      subject: "owner-1",
    });
    expect(updateTagSpy).toHaveBeenCalled();
  });

  it("refuses an owner smuggled in by the caller instead of honoring it", async () => {
    const result = await createHouseholdAction({
      name: "The Neely house",
      ownerUserId: "someone-else",
    } as never);

    expect(result.ok).toBe(false);
    expect(createHousehold).not.toHaveBeenCalled();
    expect(requireAdmittedOwnerForActionSpy).toHaveBeenCalledWith();
  });

  it("returns the private admission conflict as data instead of throwing", async () => {
    const conflict = "You're already in a household.";
    createHousehold.mockRejectedValue(new HouseholdAdmissionConflictError(conflict));

    await expect(createHouseholdAction({ name: "Second home" })).resolves.toEqual({
      ok: false,
      error: conflict,
    });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  it("renders the domain's naming rule rather than a second copy of it", async () => {
    createHousehold.mockRejectedValue(new HouseholdValidationError("Give the household a name."));

    await expect(createHouseholdAction({ name: "   " })).resolves.toEqual({
      ok: false,
      error: "Give the household a name.",
    });
  });

  it("fails closed when the household cannot be read back after creation", async () => {
    getHouseholdOverviewForUser.mockResolvedValue(null);

    await expect(createHouseholdAction({ name: "The Neely house" })).rejects.toThrow(
      "Household overview unavailable after creation.",
    );
  });
});
