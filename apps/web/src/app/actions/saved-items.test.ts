import {
  SavedItemConflictError,
  SavedItemUnavailableDestinationError,
  SavedItemValidationError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateTagSpy } from "@/test/action-adapter-mocks";

const {
  archiveHouseholdSavedItem,
  createHouseholdSavedItem,
  createSavedItem,
  deleteUniqueSavedItemSource,
  editHouseholdSavedItem,
  editSavedItem,
  getHouseholdSavedItem,
  getSavedItem,
  listShareableHouseholdMembersForUser,
  promoteHouseholdSavedItem,
  promoteSavedItemToGeneralAction,
  resolveScopeForCaller,
} = vi.hoisted(() => ({
  archiveHouseholdSavedItem: vi.fn(),
  createHouseholdSavedItem: vi.fn(),
  createSavedItem: vi.fn(),
  deleteUniqueSavedItemSource: vi.fn(),
  editHouseholdSavedItem: vi.fn(),
  editSavedItem: vi.fn(),
  getHouseholdSavedItem: vi.fn(),
  getSavedItem: vi.fn(),
  listShareableHouseholdMembersForUser: vi.fn(),
  promoteHouseholdSavedItem: vi.fn(),
  promoteSavedItemToGeneralAction: vi.fn(),
  resolveScopeForCaller: vi.fn(),
}));

vi.mock("@tendnote/db/queries/saved-items", () => ({
  createSavedItem,
  deleteUniqueSavedItemSource,
  promoteSavedItemToGeneralAction,
  archiveSavedItem: vi.fn(),
  editSavedItem,
  getSavedItemSourceDeletionImpact: vi.fn(),
  getSavedItem,
  reopenSavedItem: vi.fn(),
  resolveSavedItem: vi.fn(),
  listSavedItems: vi.fn(),
  archiveHouseholdSavedItem,
  createHouseholdSavedItem,
  editHouseholdSavedItem,
  getHouseholdSavedItem,
  promoteHouseholdSavedItem,
  resolveHouseholdSavedItem: vi.fn(),
  restoreHouseholdSavedItem: vi.fn(),
}));
vi.mock("@tendnote/db/queries/reminders", () => ({ listReminderSchedulesForOwner: vi.fn() }));
vi.mock("@tendnote/db/queries/households", () => ({ listShareableHouseholdMembersForUser }));
vi.mock("@/lib/resolve-scope-for-caller", () => ({ resolveScopeForCaller }));

import {
  archiveHouseholdSavedItemAction,
  createHouseholdSavedItemAction,
  createSavedItemAction,
  deleteUniqueSavedItemSourceAction,
  editHouseholdSavedItemAction,
  editSavedItemAction,
  getHouseholdSavedItemViewAction,
  promoteHouseholdSavedItemAction,
  promoteSavedItemToGeneralActionAction,
} from "./saved-items";

const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-1" as string | null,
  ownership: "member_owned" as const,
  version: 1,
  kind: "note" as const,
  title: "Filter measurements",
  content: "Eight inches",
  url: null,
  status: "active" as const,
  bringBackAt: null,
  bringBackTimeSemantics: "date_only" as const,
  sourceRecordId: "22222222-2222-4222-8222-222222222222",
  scope: "private" as const,
  householdId: null as string | null,
  resolvedAt: null,
  resolutionReason: null,
  createdByUserId: "owner-1" as string | null,
  lastActorUserId: "owner-1" as string | null,
  createdAt: new Date("2026-07-21T12:00:00Z"),
  updatedAt: new Date("2026-07-21T12:00:00Z"),
  sharedWithUserIds: [],
  householdName: null,
  outcomes: [],
};

const HOUSEHOLD_ITEM = {
  ...ITEM,
  ownerUserId: null,
  ownership: "household_native" as const,
  version: 3,
  scope: "household" as const,
  householdId: "44444444-4444-4444-8444-444444444444",
  createdByUserId: "member-2",
  lastActorUserId: "member-2",
  householdName: "Home",
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveScopeForCaller.mockResolvedValue({ scope: "private", householdId: null });
  listShareableHouseholdMembersForUser.mockResolvedValue([
    { userId: "member-2", name: "Ben", email: "ben@example.com" },
  ]);
  createSavedItem.mockResolvedValue({
    result: ITEM,
    affectedScopes: [
      { kind: "owner-collection", collection: "saved-items", ownerUserId: "owner-1" },
    ],
  });
  editSavedItem.mockResolvedValue({ result: ITEM, affectedScopes: [] });
  getSavedItem.mockResolvedValue(ITEM);
  promoteSavedItemToGeneralAction.mockResolvedValue({ result: ITEM, affectedScopes: [] });
  deleteUniqueSavedItemSource.mockResolvedValue({
    result: { deletedSavedItemId: ITEM.id, deletedSourceRecordId: ITEM.sourceRecordId },
    affectedScopes: [],
  });
  createHouseholdSavedItem.mockResolvedValue({ result: HOUSEHOLD_ITEM, affectedScopes: [] });
  editHouseholdSavedItem.mockResolvedValue({ result: HOUSEHOLD_ITEM, affectedScopes: [] });
  archiveHouseholdSavedItem.mockResolvedValue({
    result: { ...HOUSEHOLD_ITEM, status: "archived" as const },
    affectedScopes: [],
  });
  getHouseholdSavedItem.mockResolvedValue(HOUSEHOLD_ITEM);
  promoteHouseholdSavedItem.mockResolvedValue({ result: HOUSEHOLD_ITEM, affectedScopes: [] });
});

describe("Saved Item server adapters", () => {
  it("derives owner scope server-side and preserves original wording", async () => {
    const result = await createSavedItemAction({
      kind: "note",
      title: "Filter measurements",
      content: "Eight inches",
    });

    expect(createSavedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        scope: "private",
        originalText: "Eight inches",
        bringBackTimeSemantics: "date_only",
      }),
    );
    expect(result).toMatchObject({ ok: true, view: { title: "Filter measurements" } });
    expect(updateTagSpy).toHaveBeenCalledWith("saved-item:viewer:owner-1:collection");
  });

  it("keeps a private capture free of the household member read it would not use", async () => {
    await createSavedItemAction({ kind: "note", title: "Filter measurements" });

    expect(listShareableHouseholdMembersForUser).not.toHaveBeenCalled();
  });

  it("marks a datetime-local bring-back as an explicit instant", async () => {
    await createSavedItemAction({
      kind: "note",
      title: "Filter measurements",
      content: "Eight inches",
      bringBackAt: "2026-08-14T16:00",
    });

    expect(createSavedItem).toHaveBeenCalledWith(
      expect.objectContaining({ bringBackTimeSemantics: "instant" }),
    );
  });

  it("supplies explicit authority and a stable retry key for promotion", async () => {
    promoteSavedItemToGeneralAction.mockResolvedValue({
      result: {
        ...ITEM,
        outcomes: [
          {
            destinationKind: "general_action",
            destinationRecordId: "33333333-3333-4333-8333-333333333333",
          },
        ],
      },
      affectedScopes: [
        {
          kind: "viewer-entity",
          entity: "general-action",
          entityId: "33333333-3333-4333-8333-333333333333",
          viewerUserId: "owner-1",
        },
      ],
    });
    await promoteSavedItemToGeneralActionAction({ savedItemId: ITEM.id });
    await promoteSavedItemToGeneralActionAction({ savedItemId: ITEM.id });

    expect(promoteSavedItemToGeneralAction).toHaveBeenNthCalledWith(2, {
      actorUserId: "owner-1",
      savedItemId: ITEM.id,
      authority: "explicit",
      idempotencyKey: `saved-item:${ITEM.id}:general-action`,
      destination: "member_owned",
      title: undefined,
    });
    expect(updateTagSpy).toHaveBeenCalledWith(
      "action:owner:owner-1:action:33333333-3333-4333-8333-333333333333",
    );
  });

  it("gives the confirmed household hand-off its own destination and retry key", async () => {
    await promoteSavedItemToGeneralActionAction({
      savedItemId: ITEM.id,
      destination: "household_native",
    });

    expect(promoteSavedItemToGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "household_native",
        idempotencyKey: `saved-item:${ITEM.id}:household-general-action`,
      }),
    );
  });

  it("forwards every supplied edit field and preserves explicit clearing values", async () => {
    await editSavedItemAction({
      savedItemId: ITEM.id,
      title: "Updated measurements",
      content: "",
      url: null,
      bringBackAt: null,
    });

    expect(editSavedItem).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: ITEM.id,
      edit: {
        title: "Updated measurements",
        content: null,
        url: null,
        bringBackAt: null,
        bringBackTimeSemantics: "date_only",
      },
    });
  });

  it("does not turn absent edit fields into destructive clears", async () => {
    await editSavedItemAction({ savedItemId: ITEM.id });

    expect(editSavedItem).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: ITEM.id,
      edit: {},
    });
  });

  it("returns a user-safe message for an invalid bring-back time", async () => {
    const result = await editSavedItemAction({
      savedItemId: ITEM.id,
      bringBackAt: "not-a-date",
    });

    expect(result).toEqual({
      ok: false,
      error: "Choose a valid bring-back time.",
    });
    expect(editSavedItem).not.toHaveBeenCalled();
  });

  it("returns the first field-level validation message", async () => {
    const result = await editSavedItemAction({
      savedItemId: "not-a-uuid",
      title: "",
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? null : result.error).toMatch(/UUID|characters/);
    expect(editSavedItem).not.toHaveBeenCalled();
  });

  it("rethrows unexpected infrastructure failures", async () => {
    editSavedItem.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(editSavedItemAction({ savedItemId: ITEM.id })).rejects.toThrow(
      "database unavailable",
    );
  });

  it("returns an inline refusal when unique source evidence is shared or reused", async () => {
    deleteUniqueSavedItemSource.mockRejectedValue(
      new SavedItemValidationError(
        "This source is shared or reused. Review its impact before deleting evidence.",
      ),
    );

    await expect(deleteUniqueSavedItemSourceAction({ savedItemId: ITEM.id })).resolves.toEqual({
      ok: false,
      error: "This source is shared or reused. Review its impact before deleting evidence.",
    });
  });
});

describe("household-native Saved Item server adapters", () => {
  it("resolves the household from the caller's own membership, never from the client", async () => {
    resolveScopeForCaller.mockResolvedValue({
      scope: "household",
      householdId: HOUSEHOLD_ITEM.householdId,
    });

    const result = await createHouseholdSavedItemAction({
      kind: "note",
      title: "Filter measurements",
      content: "Eight inches",
    });

    expect(resolveScopeForCaller).toHaveBeenCalledWith("owner-1", "whole_household");
    expect(createHouseholdSavedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "owner-1",
        householdId: HOUSEHOLD_ITEM.householdId,
        originalText: "Eight inches",
      }),
    );
    expect(result).toMatchObject({ ok: true, view: { visibilityLabel: "Household" } });
  });

  it("refuses a household capture from a member with no workspace", async () => {
    const result = await createHouseholdSavedItemAction({ kind: "note", title: "Filter" });

    expect(result).toMatchObject({ ok: false });
    expect(createHouseholdSavedItem).not.toHaveBeenCalled();
  });

  it("names the creator from the caller's household rather than showing an id", async () => {
    resolveScopeForCaller.mockResolvedValue({
      scope: "household",
      householdId: HOUSEHOLD_ITEM.householdId,
    });

    const result = await createHouseholdSavedItemAction({ kind: "note", title: "Filter" });

    expect(result).toMatchObject({ ok: true, view: { createdByLabel: "Created by Ben" } });
  });

  it("sends the version the member had in front of them", async () => {
    await editHouseholdSavedItemAction({
      savedItemId: ITEM.id,
      expectedVersion: 3,
      title: "Updated measurements",
    });

    expect(editHouseholdSavedItem).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: ITEM.id,
      expectedVersion: 3,
      edit: { title: "Updated measurements" },
    });
  });

  it("treats an omitted version as the member's deliberate replace", async () => {
    await editHouseholdSavedItemAction({ savedItemId: ITEM.id, title: "Updated measurements" });

    expect(editHouseholdSavedItem).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: undefined }),
    );
  });

  it("returns the current value alongside the refusal when a write is stale", async () => {
    editHouseholdSavedItem.mockRejectedValue(
      new SavedItemConflictError({
        savedItemId: ITEM.id,
        version: 4,
        title: "Filter measurements, revised",
        content: "Ten inches",
        url: null,
        bringBackAt: null,
        status: "active",
        lastActorUserId: "member-2",
        updatedAt: new Date("2026-07-22T12:00:00Z"),
      }),
    );

    const result = await editHouseholdSavedItemAction({
      savedItemId: ITEM.id,
      expectedVersion: 3,
      title: "Mine",
    });

    expect(result).toEqual({
      ok: false,
      error: "Someone else changed this while you were writing. Your draft is kept below.",
      savedItemConflict: {
        savedItemId: ITEM.id,
        version: 4,
        title: "Filter measurements, revised",
        content: "Ten inches",
        url: null,
        bringBackAt: null,
        status: "active",
        lastActorUserId: "member-2",
        updatedAt: "2026-07-22T12:00:00.000Z",
      },
    });
  });

  it("moves a household-native item through its lifecycle without a version to reconcile", async () => {
    await archiveHouseholdSavedItemAction({ savedItemId: ITEM.id });

    expect(archiveHouseholdSavedItem).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: ITEM.id,
    });
  });

  it("reads the stored value back so a member can adopt it", async () => {
    const result = await getHouseholdSavedItemViewAction({ savedItemId: ITEM.id });

    expect(getHouseholdSavedItem).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: ITEM.id,
    });
    expect(result).toMatchObject({ ok: true, view: { canEdit: true, canDeleteEvidence: false } });
  });

  it("promotes a workspace-owned item on the household's retry key once the destination exists", async () => {
    await promoteHouseholdSavedItemAction({ savedItemId: ITEM.id });

    expect(promoteHouseholdSavedItem).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      savedItemId: ITEM.id,
      idempotencyKey: `saved-item:${ITEM.id}:household-general-action`,
      title: undefined,
    });
  });

  // Flagged rather than merely worded calmly: by the time a refusal reaches a
  // row it is only a string, and a row cannot tell "not built yet" from "you got
  // this wrong" without reading the sentence. The flag is what keeps the calm
  // copy out of the destructive, assertive error line.
  it("refuses a household Action as an unavailable destination, not a mistake", async () => {
    promoteHouseholdSavedItem.mockRejectedValue(
      new SavedItemUnavailableDestinationError(
        "Household Actions aren't available yet, so this can stay here for now.",
      ),
    );

    await expect(promoteHouseholdSavedItemAction({ savedItemId: ITEM.id })).resolves.toEqual({
      ok: false,
      error: "Household Actions aren't available yet, so this can stay here for now.",
      unavailableDestination: true,
    });
  });

  it("refuses the member-owned hand-off the same way, and only for that destination", async () => {
    promoteSavedItemToGeneralAction.mockRejectedValue(
      new SavedItemUnavailableDestinationError(
        "Household Actions aren't available yet, so this can stay here for now.",
      ),
    );

    await expect(
      promoteSavedItemToGeneralActionAction({
        savedItemId: ITEM.id,
        destination: "household_native",
      }),
    ).resolves.toMatchObject({ ok: false, unavailableDestination: true });

    await promoteSavedItemToGeneralActionAction({ savedItemId: ITEM.id });
    expect(promoteSavedItemToGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({ savedItemId: ITEM.id, destination: "member_owned" }),
    );
  });
});
