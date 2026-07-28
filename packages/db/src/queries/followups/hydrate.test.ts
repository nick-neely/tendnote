import type { Followup } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { hydrateFollowup, hydrateFollowups } from "./hydrate";

const followup: Followup = {
  id: "followup-1",
  personId: "person-1",
  ownerUserId: "owner-1",
  reason: "Ask about the move.",
  dueAt: new Date("2026-08-01T00:00:00.000Z"),
  status: "open",
  cadence: null,
  sourceRecordId: null,
  lastPromptedAt: null,
  householdId: "household-1",
  scope: "shared",
  createdByUserId: "owner-1",
  lastActorUserId: "owner-1",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-02T00:00:00.000Z"),
};

describe("Follow-Up surfacing hydration", () => {
  it("names the Household Workspace and counts selected members", async () => {
    const getHouseholdWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "household-1",
        name: "Home",
      },
    ]);
    const listHouseholdRecordSharesForRecords = vi.fn().mockResolvedValue([
      { recordId: "followup-1", sharedWithUserId: "member-1" },
      { recordId: "followup-1", sharedWithUserId: "member-2" },
    ]);

    await expect(
      hydrateFollowup({ getHouseholdWorkspaces, listHouseholdRecordSharesForRecords }, followup),
    ).resolves.toMatchObject({
      householdName: "Home",
      sharedWithCount: 2,
    });
    expect(listHouseholdRecordSharesForRecords).toHaveBeenCalledWith({
      householdIds: ["household-1"],
      recordKind: "followup",
      recordIds: ["followup-1"],
    });
  });

  it("does not query household context for a private Follow-Up", async () => {
    const getHouseholdWorkspaces = vi.fn();
    const listHouseholdRecordSharesForRecords = vi.fn();

    await expect(
      hydrateFollowup(
        { getHouseholdWorkspaces, listHouseholdRecordSharesForRecords },
        { ...followup, householdId: null, scope: "private" },
      ),
    ).resolves.toMatchObject({ householdName: null, sharedWithCount: 0 });
    expect(getHouseholdWorkspaces).not.toHaveBeenCalled();
    expect(listHouseholdRecordSharesForRecords).not.toHaveBeenCalled();
  });

  it("hydrates a list with one household query and one share query", async () => {
    const getHouseholdWorkspaces = vi.fn().mockResolvedValue([
      { id: "household-1", name: "Home" },
      { id: "household-2", name: "Cabin" },
    ]);
    const listHouseholdRecordSharesForRecords = vi.fn().mockResolvedValue([
      { recordId: "followup-1", sharedWithUserId: "member-1" },
      { recordId: "followup-2", sharedWithUserId: "member-2" },
    ]);

    await expect(
      hydrateFollowups({ getHouseholdWorkspaces, listHouseholdRecordSharesForRecords }, [
        followup,
        {
          ...followup,
          id: "followup-2",
          householdId: "household-2",
        },
      ]),
    ).resolves.toMatchObject([
      { householdName: "Home", sharedWithCount: 1 },
      { householdName: "Cabin", sharedWithCount: 1 },
    ]);
    expect(getHouseholdWorkspaces).toHaveBeenCalledTimes(1);
    expect(listHouseholdRecordSharesForRecords).toHaveBeenCalledTimes(1);
  });
});
