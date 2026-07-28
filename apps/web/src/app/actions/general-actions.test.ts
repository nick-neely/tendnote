import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy } from "@/test/action-adapter-mocks";

const {
  createGeneralAction,
  editGeneralAction,
  listLinkedAssetsForGeneralActions,
  listReminderSchedulesForOwner,
  resolveScopeForCaller,
  setGeneralActionVisibility,
  toGeneralActionLinkedAssetView,
  toGeneralActionView,
} = vi.hoisted(() => ({
  createGeneralAction: vi.fn(),
  editGeneralAction: vi.fn(),
  listLinkedAssetsForGeneralActions: vi.fn(),
  listReminderSchedulesForOwner: vi.fn(),
  resolveScopeForCaller: vi.fn(),
  setGeneralActionVisibility: vi.fn(),
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
  setGeneralActionVisibility,
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
vi.mock("@/lib/cache/reconcile-affected-scopes", () => ({
  reconcileAffectedScopes: vi.fn(),
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

import {
  completeGeneralActionAction,
  createGeneralActionAction,
  editGeneralActionAction,
  getActionSecondaryLedgerViewsAction,
  listGeneralActionHistoryAction,
  setGeneralActionVisibilityAction,
} from "./general-actions";

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
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  createGeneralAction.mockResolvedValue({ result: ACTION, affectedScopes: AFFECTED_SCOPES });
  editGeneralAction.mockResolvedValue({ result: ACTION, affectedScopes: AFFECTED_SCOPES });
  setGeneralActionVisibility.mockResolvedValue({
    result: ACTION,
    affectedScopes: AFFECTED_SCOPES,
  });
  listLinkedAssetsForGeneralActions.mockResolvedValue({});
  listReminderSchedulesForOwner.mockResolvedValue([]);
  resolveScopeForCaller.mockResolvedValue({ scope: "private", householdId: null });
});

describe("General Action server adapters", () => {
  it("reaches admission before inspecting malformed mutation or read inputs", async () => {
    requireAdmittedOwnerForActionSpy.mockRejectedValue(new Error("You must be signed in."));

    await expect(editGeneralActionAction(undefined as never)).rejects.toThrow("signed in");
    await expect(completeGeneralActionAction(undefined as never)).rejects.toThrow("signed in");
    await expect(listGeneralActionHistoryAction(undefined as never)).rejects.toThrow("signed in");
    await expect(getActionSecondaryLedgerViewsAction(undefined as never)).rejects.toThrow(
      "signed in",
    );

    expect(editGeneralAction).not.toHaveBeenCalled();
  });

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
    expect(result).toEqual({ ok: true, view: ACTION });
  });

  it("returns validation failures without calling the shared create mutation", async () => {
    const result = await createGeneralActionAction({ title: " " });

    expect(result).toEqual({ ok: false, error: "Name the action." });
    expect(createGeneralAction).not.toHaveBeenCalled();
  });

  it("hands every visibility choice to the shared owner-scope resolver", async () => {
    resolveScopeForCaller.mockResolvedValueOnce({
      scope: "household",
      householdId: "household-1",
    });

    await setGeneralActionVisibilityAction({
      generalActionId: ACTION_ID,
      visibilityChoice: "whole_household",
    });

    expect(resolveScopeForCaller).toHaveBeenCalledWith("owner-1", "whole_household");
    expect(setGeneralActionVisibility).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      generalActionId: ACTION_ID,
      scope: "household",
      householdId: "household-1",
      selectedUserIds: undefined,
    });
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
