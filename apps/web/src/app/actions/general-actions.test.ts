import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePathSpy } from "@/test/action-adapter-mocks";

const {
  createGeneralAction,
  editGeneralAction,
  listLinkedAssetsForGeneralActions,
  listReminderSchedulesForOwner,
  reconcileAffectedScopes,
  resolveScopeForCaller,
  toGeneralActionLinkedAssetView,
  toGeneralActionView,
} = vi.hoisted(() => ({
  createGeneralAction: vi.fn(),
  editGeneralAction: vi.fn(),
  listLinkedAssetsForGeneralActions: vi.fn(),
  listReminderSchedulesForOwner: vi.fn(),
  reconcileAffectedScopes: vi.fn(),
  resolveScopeForCaller: vi.fn(),
  toGeneralActionLinkedAssetView: vi.fn((entry) => entry),
  toGeneralActionView: vi.fn((action) => action),
}));

vi.mock("@tendnote/db/queries/assets", () => ({
  listLinkedAssetsForGeneralActions,
  promoteGeneralActionAssetHint: vi.fn(),
}));
vi.mock("@tendnote/db/queries/general-action-areas", () => ({
  listGeneralActionAreas: vi.fn(),
}));
vi.mock("@tendnote/db/queries/general-actions", () => ({
  archiveGeneralAction: vi.fn(),
  completeGeneralAction: vi.fn(),
  createGeneralAction,
  deferGeneralAction: vi.fn(),
  dismissGeneralAction: vi.fn(),
  editGeneralAction,
  getGeneralAction: vi.fn(),
  listGeneralActionHistory: vi.fn(),
  listSuggestedGeneralActionReviews: vi.fn(),
  pauseGeneralAction: vi.fn(),
  reopenGeneralAction: vi.fn(),
  restoreGeneralAction: vi.fn(),
  resumeGeneralAction: vi.fn(),
  setGeneralActionPeople: vi.fn(),
  setGeneralActionVisibility: vi.fn(),
  skipGeneralActionOccurrence: vi.fn(),
  undeferGeneralAction: vi.fn(),
  undoRoutineOccurrence: vi.fn(),
}));
vi.mock("@tendnote/db/queries/households", () => ({
  listShareableHouseholdMembersForUser: vi.fn(),
}));
vi.mock("@tendnote/db/queries/people", () => ({ searchPeople: vi.fn() }));
vi.mock("@tendnote/db/queries/reminders", () => ({ listReminderSchedulesForOwner }));
vi.mock("@/lib/cache/action-views", () => ({ getCachedActionLedgerViews: vi.fn() }));
vi.mock("@/lib/cache/reconcile-affected-scopes", () => ({ reconcileAffectedScopes }));
vi.mock("@/lib/cache/today-review-mutation-scopes", () => ({
  invalidateReviewOwner: vi.fn(),
}));
vi.mock("@/lib/general-action-view", () => ({
  toGeneralActionEventView: vi.fn(),
  toGeneralActionLinkedAssetView,
  toGeneralActionView,
}));
vi.mock("@/lib/resolve-scope-for-caller", () => ({ resolveScopeForCaller }));
vi.mock("@/lib/suggested-general-action-review-view", () => ({
  toSuggestedGeneralActionReviewView: vi.fn(),
}));

import { createGeneralActionAction, editGeneralActionAction } from "./general-actions";

const ACTION_ID = randomUUID();
const PERSON_ID = randomUUID();
const AREA_ID = randomUUID();

const ACTION = {
  id: ACTION_ID,
  title: "Replace the water filter",
};
const AFFECTED_SCOPES = [
  {
    kind: "viewer-collection",
    collection: "general-actions",
    viewerUserId: "owner-1",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  createGeneralAction.mockResolvedValue({ result: ACTION, affectedScopes: AFFECTED_SCOPES });
  editGeneralAction.mockResolvedValue({ result: ACTION, affectedScopes: AFFECTED_SCOPES });
  listLinkedAssetsForGeneralActions.mockResolvedValue({});
  listReminderSchedulesForOwner.mockResolvedValue([]);
  resolveScopeForCaller.mockResolvedValue({ scope: "private", householdId: null });
});

describe("General Action server adapters", () => {
  it("derives the owner from the session and invalidates the authoritative action projections", async () => {
    const result = await createGeneralActionAction({
      title: "Replace the water filter",
      personIds: [PERSON_ID],
    });

    expect(createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        title: "Replace the water filter",
        personIds: [PERSON_ID],
        scope: "private",
        householdId: null,
      }),
    );
    expect(reconcileAffectedScopes).toHaveBeenCalledWith(AFFECTED_SCOPES, {
      origin: "owner-action",
    });
    expect(revalidatePathSpy).toHaveBeenCalledWith("/actions");
    expect(result).toEqual({ ok: true, view: ACTION });
  });

  it("returns validation failures without calling the shared create mutation", async () => {
    const result = await createGeneralActionAction({ title: " " });

    expect(result).toEqual({ ok: false, error: "Name the action." });
    expect(createGeneralAction).not.toHaveBeenCalled();
    expect(reconcileAffectedScopes).not.toHaveBeenCalled();
  });

  it("forwards every supplied edit field and preserves explicit clearing values", async () => {
    await editGeneralActionAction({
      generalActionId: ACTION_ID,
      edit: {
        title: "Replace both water filters",
        notes: null,
        dueAt: null,
        recurrence: null,
        links: [{ url: "https://example.com/filter", label: "Filter guide" }],
        assetHints: ["Kitchen filter"],
        areaId: AREA_ID,
      },
    });

    expect(editGeneralAction).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      generalActionId: ACTION_ID,
      edit: {
        title: "Replace both water filters",
        notes: null,
        dueAt: null,
        recurrence: null,
        links: [{ url: "https://example.com/filter", label: "Filter guide" }],
        assetHints: [{ label: "Kitchen filter" }],
        areaId: AREA_ID,
      },
    });
  });

  it("does not turn absent edit fields into destructive clears", async () => {
    await editGeneralActionAction({ generalActionId: ACTION_ID, edit: {} });

    expect(editGeneralAction).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      generalActionId: ACTION_ID,
      edit: {},
    });
  });
});
