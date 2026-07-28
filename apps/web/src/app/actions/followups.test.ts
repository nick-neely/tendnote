import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateTagSpy } from "@/test/action-adapter-mocks";

const { createFollowup, listActiveHouseholdMembershipsForUser } = vi.hoisted(() => ({
  createFollowup: vi.fn(),
  listActiveHouseholdMembershipsForUser: vi.fn(),
}));

vi.mock("@tendnote/db/queries/followups", () => ({
  archiveFollowup: vi.fn(),
  completeFollowup: vi.fn(),
  createBirthdayFollowupReminder: vi.fn(),
  createFollowup,
  dismissFollowup: vi.fn(),
  editFollowup: vi.fn(),
  reopenFollowup: vi.fn(),
  snoozeFollowup: vi.fn(),
}));
vi.mock("@tendnote/db/queries/households", () => ({
  listActiveHouseholdMembershipsForUser,
}));

import { createFollowupAction } from "./followups";

const FOLLOWUP_ID = randomUUID();
const PERSON_ID = randomUUID();
const HOUSEHOLD_ID = randomUUID();
const DUE_AT = new Date(2026, 7, 15);

const FOLLOWUP = {
  id: FOLLOWUP_ID,
  personId: PERSON_ID,
  ownerUserId: "owner-1",
  reason: "Ask how the move went",
  dueAt: DUE_AT,
  status: "open" as const,
  cadence: null,
  sourceRecordId: null,
  lastPromptedAt: null,
  householdId: null,
  scope: "private" as const,
  createdByUserId: "owner-1",
  lastActorUserId: "owner-1",
  createdAt: new Date("2026-07-27T12:00:00Z"),
  updatedAt: new Date("2026-07-27T12:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  createFollowup.mockResolvedValue({
    result: FOLLOWUP,
    affectedScopes: [
      { kind: "owner-collection", collection: "people", ownerUserId: "owner-1" },
      {
        kind: "viewer-entity",
        entity: "person",
        entityId: PERSON_ID,
        viewerUserId: "owner-1",
      },
      { kind: "visible-entity", entity: "person", entityId: PERSON_ID },
    ],
  });
  listActiveHouseholdMembershipsForUser.mockResolvedValue([{ householdId: HOUSEHOLD_ID }]);
});

describe("Follow-Up server adapters", () => {
  it("derives a private owner scope from the session and invalidates the affected person", async () => {
    const result = await createFollowupAction({
      personId: PERSON_ID,
      reason: "Ask how the move went",
      dueAt: "2026-08-15",
    });

    expect(createFollowup).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      personId: PERSON_ID,
      reason: "Ask how the move went",
      dueAt: DUE_AT,
      scope: "private",
      householdId: null,
      selectedUserIds: undefined,
    });
    expect(listActiveHouseholdMembershipsForUser).not.toHaveBeenCalled();
    expect(updateTagSpy).toHaveBeenCalledWith(`people:owner:owner-1:person:${PERSON_ID}`);
    expect(updateTagSpy).toHaveBeenCalledWith(`people:visible-person:${PERSON_ID}`);
    expect(result).toMatchObject({ ok: true, view: { id: FOLLOWUP_ID } });
  });

  it("resolves the active household before creating a shared Follow-Up", async () => {
    await createFollowupAction({
      personId: PERSON_ID,
      reason: "Ask how the move went",
      dueAt: "2026-08-15",
      visibilityChoice: "selected_members",
      selectedUserIds: ["household-member-1"],
    });

    expect(listActiveHouseholdMembershipsForUser).toHaveBeenCalledWith({
      userId: "owner-1",
    });
    expect(createFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        scope: "shared",
        householdId: HOUSEHOLD_ID,
        selectedUserIds: ["household-member-1"],
      }),
    );
  });

  it("returns invalid input through the owner-action result before calling the mutation", async () => {
    await expect(
      createFollowupAction({ personId: PERSON_ID, reason: " ", dueAt: "2026-08-15" }),
    ).resolves.toEqual({ ok: false, error: "Add a reason for this follow-up." });

    expect(createFollowup).not.toHaveBeenCalled();
    expect(updateTagSpy).not.toHaveBeenCalled();
  });
});
