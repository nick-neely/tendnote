import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionLifecycleStore } from "./in-memory-store";
import {
  createAffectedGeneralActionLifecycle,
  suggestedGeneralActionMutationOutcome,
} from "./mutation-lifecycle";
import { createSuggestedGeneralActionReview } from "./review";

const OWNER = "owner-1";
const MEMBER = "member-1";

function expectedPrivateScopes(actionId: string) {
  return [
    {
      kind: "viewer-collection",
      collection: "general-actions",
      viewerUserId: OWNER,
    },
    {
      kind: "viewer-entity",
      entity: "general-action",
      entityId: actionId,
      viewerUserId: OWNER,
    },
    { kind: "owner-collection", collection: "today", ownerUserId: OWNER },
    { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
  ];
}

async function createSharedHousehold(
  store: ReturnType<typeof createInMemoryGeneralActionLifecycleStore>,
) {
  const household = await store.createHouseholdWorkspace({
    ownerUserId: OWNER,
    name: "Home",
    defaultScope: "private",
  });
  for (const [userId, role] of [
    [OWNER, "owner"],
    [MEMBER, "member"],
  ] as const) {
    await store.createHouseholdMembership({
      householdId: household.id,
      userId,
      invitedByUserId: OWNER,
      role,
      status: "active",
      invitedAt: new Date("2026-07-01T00:00:00Z"),
      acceptedAt: new Date("2026-07-01T00:00:00Z"),
      removedAt: null,
    });
  }
  return household;
}

describe("General Action affected-scope contract", () => {
  it("returns the authoritative result with its viewer and owner collection scopes", async () => {
    const lifecycle = createAffectedGeneralActionLifecycle(
      createInMemoryGeneralActionLifecycleStore(),
    );

    const outcome = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the water filter",
    });

    expect(outcome.result).toMatchObject({
      ownerUserId: OWNER,
      title: "Replace the water filter",
    });
    expect(outcome.affectedScopes).toEqual(expectedPrivateScopes(outcome.result.id));
  });

  it("returns the same scope contract for every lifecycle mutation", async () => {
    const lifecycle = createAffectedGeneralActionLifecycle(
      createInMemoryGeneralActionLifecycleStore(),
    );
    const created = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the water filter",
      dueAt: new Date("2026-08-01T00:00:00Z"),
    });
    const actionId = created.result.id;
    const expected = expectedPrivateScopes(actionId);

    const edited = await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
      edit: { title: "Replace the fridge water filter" },
    });
    expect(edited.affectedScopes).toEqual(expected);

    const people = await lifecycle.setGeneralActionPeople({
      actorUserId: OWNER,
      generalActionId: actionId,
      personIds: [],
    });
    expect(people.affectedScopes).toEqual(expected);

    const deferred = await lifecycle.deferGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
      deferUntil: new Date("2026-08-02T00:00:00Z"),
    });
    expect(deferred.affectedScopes).toEqual(expected);

    const undeferred = await lifecycle.undeferGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(undeferred.affectedScopes).toEqual(expected);

    const completed = await lifecycle.completeGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(completed.affectedScopes).toEqual(expected);

    const reopened = await lifecycle.reopenGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(reopened.affectedScopes).toEqual(expected);

    const dismissed = await lifecycle.dismissGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(dismissed.affectedScopes).toEqual(expected);

    const reopenedAfterDismiss = await lifecycle.reopenGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(reopenedAfterDismiss.affectedScopes).toEqual(expected);

    const archived = await lifecycle.archiveGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(archived.affectedScopes).toEqual(expected);

    const restored = await lifecycle.restoreGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(restored.affectedScopes).toEqual(expected);
  });

  it("returns scopes for every Routine occurrence and lifecycle mutation", async () => {
    const lifecycle = createAffectedGeneralActionLifecycle(
      createInMemoryGeneralActionLifecycleStore(),
    );
    const originalDueAt = new Date("2026-08-01T00:00:00Z");
    const created = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the water filter",
      dueAt: originalDueAt,
      recurrence: { interval: 6, unit: "month" },
    });
    const actionId = created.result.id;
    const expected = expectedPrivateScopes(actionId);

    const skipped = await lifecycle.skipGeneralActionOccurrence({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(skipped.affectedScopes).toEqual(expected);
    const advancedDueAt = skipped.result.dueAt;
    if (!advancedDueAt) throw new Error("Expected the Routine occurrence to advance.");

    const undone = await lifecycle.undoRoutineOccurrence({
      actorUserId: OWNER,
      expectedDueAt: advancedDueAt,
      generalActionId: actionId,
      restoreDueAt: originalDueAt,
    });
    expect(undone.affectedScopes).toEqual(expected);

    const paused = await lifecycle.pauseGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(paused.affectedScopes).toEqual(expected);

    const resumed = await lifecycle.resumeGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(resumed.affectedScopes).toEqual(expected);

    const completed = await lifecycle.completeGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    expect(completed.affectedScopes).toEqual(expected);
  });

  it("invalidates both the former and current audience when visibility changes", async () => {
    const store = createInMemoryGeneralActionLifecycleStore();
    const household = await createSharedHousehold(store);
    const lifecycle = createAffectedGeneralActionLifecycle(store);
    const created = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Plan the household repair",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });

    const narrowed = await lifecycle.setGeneralActionVisibility({
      actorUserId: OWNER,
      generalActionId: created.result.id,
      scope: "private",
    });

    expect(narrowed.affectedScopes).toContainEqual({
      kind: "viewer-collection",
      collection: "general-actions",
      viewerUserId: MEMBER,
    });
    expect(narrowed.affectedScopes).toContainEqual({
      kind: "viewer-entity",
      entity: "general-action",
      entityId: created.result.id,
      viewerUserId: MEMBER,
    });
  });

  it("returns every selected viewer scope when a suggestion is accepted as shared", async () => {
    const store = createInMemoryGeneralActionLifecycleStore();
    const household = await createSharedHousehold(store);
    const source = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Plan the shared household repair.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const review = createSuggestedGeneralActionReview(store);
    const suggested = await review.suggestGeneralAction({
      ownerUserId: OWNER,
      title: "Plan the household repair",
      sourceRecordId: source.id,
    });
    const accepted = await suggestedGeneralActionMutationOutcome(
      store,
      review.acceptSuggestedGeneralAction({
        actorUserId: OWNER,
        generalActionId: suggested.action.id,
        scope: "shared",
        householdId: household.id,
        selectedUserIds: [MEMBER],
      }),
      { includeCurrentAudience: true },
    );

    expect(accepted.affectedScopes).toEqual(
      expect.arrayContaining([
        {
          kind: "viewer-collection",
          collection: "general-actions",
          viewerUserId: MEMBER,
        },
        {
          kind: "viewer-entity",
          entity: "general-action",
          entityId: suggested.action.id,
          viewerUserId: MEMBER,
        },
        { kind: "owner-collection", collection: "today", ownerUserId: MEMBER },
      ]),
    );
  });
});
