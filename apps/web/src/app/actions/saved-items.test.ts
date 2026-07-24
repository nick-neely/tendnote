import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSavedItem,
  deleteUniqueSavedItemSource,
  getSavedItem,
  promoteSavedItemToGeneralAction,
  invalidateActionMutation,
  revalidatePath,
  resolveScopeForCaller,
  updateTag,
} = vi.hoisted(() => ({
  createSavedItem: vi.fn(),
  deleteUniqueSavedItemSource: vi.fn(),
  getSavedItem: vi.fn(),
  promoteSavedItemToGeneralAction: vi.fn(),
  invalidateActionMutation: vi.fn(),
  revalidatePath: vi.fn(),
  resolveScopeForCaller: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@tendnote/db/queries/saved-items", () => ({
  createSavedItem,
  deleteUniqueSavedItemSource,
  promoteSavedItemToGeneralAction,
  archiveSavedItem: vi.fn(),
  editSavedItem: vi.fn(),
  getSavedItemSourceDeletionImpact: vi.fn(),
  getSavedItem,
  reopenSavedItem: vi.fn(),
  resolveSavedItem: vi.fn(),
  listSavedItems: vi.fn(),
}));
vi.mock("@tendnote/db/queries/reminders", () => ({ listReminderSchedulesForOwner: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath, updateTag }));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwnerForAction: vi.fn().mockResolvedValue("owner-1"),
}));
vi.mock("@/lib/cache/action-mutation-scopes", () => ({ invalidateActionMutation }));
vi.mock("@/lib/resolve-scope-for-caller", () => ({ resolveScopeForCaller }));

import { createSavedItemAction, promoteSavedItemToGeneralActionAction } from "./saved-items";

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
  createSavedItem.mockResolvedValue(ITEM);
  getSavedItem.mockResolvedValue(ITEM);
  promoteSavedItemToGeneralAction.mockResolvedValue(ITEM);
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
    expect(revalidatePath).toHaveBeenCalledWith("/saved-items");
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
      ...ITEM,
      outcomes: [
        {
          destinationKind: "general_action",
          destinationRecordId: "33333333-3333-4333-8333-333333333333",
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
    expect(invalidateActionMutation).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      actionId: "33333333-3333-4333-8333-333333333333",
    });
  });
});
