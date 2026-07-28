import { SavedItemValidationError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateTagSpy } from "@/test/action-adapter-mocks";

const {
  createSavedItem,
  deleteUniqueSavedItemSource,
  editSavedItem,
  getSavedItem,
  promoteSavedItemToGeneralAction,
  resolveScopeForCaller,
} = vi.hoisted(() => ({
  createSavedItem: vi.fn(),
  deleteUniqueSavedItemSource: vi.fn(),
  editSavedItem: vi.fn(),
  getSavedItem: vi.fn(),
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
}));
vi.mock("@tendnote/db/queries/reminders", () => ({ listReminderSchedulesForOwner: vi.fn() }));
vi.mock("@/lib/resolve-scope-for-caller", () => ({ resolveScopeForCaller }));

import {
  createSavedItemAction,
  deleteUniqueSavedItemSourceAction,
  editSavedItemAction,
  promoteSavedItemToGeneralActionAction,
} from "./saved-items";

const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "owner-1",
  kind: "note" as const,
  title: "Filter measurements",
  content: "Eight inches",
  url: null,
  status: "active" as const,
  bringBackAt: null,
  bringBackTimeSemantics: "date_only" as const,
  sourceRecordId: "22222222-2222-4222-8222-222222222222",
  scope: "private" as const,
  householdId: null,
  resolvedAt: null,
  resolutionReason: null,
  createdByUserId: "owner-1",
  lastActorUserId: "owner-1",
  createdAt: new Date("2026-07-21T12:00:00Z"),
  updatedAt: new Date("2026-07-21T12:00:00Z"),
  sharedWithUserIds: [],
  householdName: null,
  outcomes: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveScopeForCaller.mockResolvedValue({ scope: "private", householdId: null });
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
    });
    expect(updateTagSpy).toHaveBeenCalledWith(
      "action:owner:owner-1:action:33333333-3333-4333-8333-333333333333",
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
