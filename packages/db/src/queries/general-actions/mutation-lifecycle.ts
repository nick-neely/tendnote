import type { GeneralAction } from "@tendnote/domain";
import type { AffectedScope, MutationOutcome } from "../affected-scopes";
import { createGeneralActionLifecycle } from "./lifecycle";
import type {
  GeneralActionLifecycleDeps,
  GeneralActionLifecycleStore,
  GeneralActionWithContext,
  SuggestedGeneralActionReviewResult,
} from "./types";

type GeneralActionResult = GeneralActionWithContext;

/**
 * Adds the affected-scope contract to the General Action lifecycle.
 *
 * The core lifecycle remains the domain transition seam. This wrapper is the write
 * boundary used by application callers: it pairs the committed result with every
 * viewer collection/entity and owner projection that can now be stale.
 */
export function createAffectedGeneralActionLifecycle(
  store: GeneralActionLifecycleStore,
  deps: GeneralActionLifecycleDeps = {},
) {
  const lifecycle = createGeneralActionLifecycle(store, deps);

  async function withAffectedScopes(
    resultPromise: Promise<GeneralActionResult>,
    previousViewerUserIds: readonly string[] = [],
  ): Promise<MutationOutcome<GeneralActionResult>> {
    const result = await resultPromise;
    return {
      result,
      affectedScopes: await scopesForGeneralAction(store, result, previousViewerUserIds),
    };
  }

  return {
    ...lifecycle,
    createGeneralAction: (input: Parameters<typeof lifecycle.createGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.createGeneralAction(input)),
    editGeneralAction: (input: Parameters<typeof lifecycle.editGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.editGeneralAction(input)),
    setGeneralActionPeople: (input: Parameters<typeof lifecycle.setGeneralActionPeople>[0]) =>
      withAffectedScopes(lifecycle.setGeneralActionPeople(input)),
    async setGeneralActionVisibility(
      input: Parameters<typeof lifecycle.setGeneralActionVisibility>[0],
    ) {
      const previous = await lifecycle.getGeneralAction(input);
      const previousViewerUserIds = await listGeneralActionViewerUserIds(store, previous);
      return withAffectedScopes(lifecycle.setGeneralActionVisibility(input), previousViewerUserIds);
    },
    completeGeneralAction: (input: Parameters<typeof lifecycle.completeGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.completeGeneralAction(input)),
    skipGeneralActionOccurrence: (
      input: Parameters<typeof lifecycle.skipGeneralActionOccurrence>[0],
    ) => withAffectedScopes(lifecycle.skipGeneralActionOccurrence(input)),
    undoRoutineOccurrence: (input: Parameters<typeof lifecycle.undoRoutineOccurrence>[0]) =>
      withAffectedScopes(lifecycle.undoRoutineOccurrence(input)),
    dismissGeneralAction: (input: Parameters<typeof lifecycle.dismissGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.dismissGeneralAction(input)),
    pauseGeneralAction: (input: Parameters<typeof lifecycle.pauseGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.pauseGeneralAction(input)),
    resumeGeneralAction: (input: Parameters<typeof lifecycle.resumeGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.resumeGeneralAction(input)),
    reopenGeneralAction: (input: Parameters<typeof lifecycle.reopenGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.reopenGeneralAction(input)),
    restoreGeneralAction: (input: Parameters<typeof lifecycle.restoreGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.restoreGeneralAction(input)),
    archiveGeneralAction: (input: Parameters<typeof lifecycle.archiveGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.archiveGeneralAction(input)),
    deferGeneralAction: (input: Parameters<typeof lifecycle.deferGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.deferGeneralAction(input)),
    undeferGeneralAction: (input: Parameters<typeof lifecycle.undeferGeneralAction>[0]) =>
      withAffectedScopes(lifecycle.undeferGeneralAction(input)),
  };
}

async function scopesForGeneralAction(
  store: GeneralActionLifecycleStore,
  current: GeneralAction,
  previousViewerUserIds: readonly string[] = [],
): Promise<AffectedScope[]> {
  const viewerUserIds = new Set([
    ...(await listGeneralActionViewerUserIds(store, current)),
    ...previousViewerUserIds,
  ]);

  return [
    ...[...viewerUserIds].flatMap((viewerUserId): AffectedScope[] => [
      {
        kind: "viewer-collection",
        collection: "general-actions",
        viewerUserId,
      },
      {
        kind: "viewer-entity",
        entity: "general-action",
        entityId: current.id,
        viewerUserId,
      },
      { kind: "owner-collection", collection: "today", ownerUserId: viewerUserId },
    ]),
    {
      kind: "owner-collection",
      collection: "review",
      ownerUserId: current.ownerUserId,
    },
  ];
}

export async function suggestedGeneralActionMutationOutcome<
  TResult extends SuggestedGeneralActionReviewResult | GeneralAction,
>(
  store: GeneralActionLifecycleStore,
  resultPromise: Promise<TResult>,
  input: { includeCurrentAudience?: boolean } = {},
): Promise<MutationOutcome<TResult>> {
  const result = await resultPromise;
  const action = ("action" in result ? result.action : result) as GeneralAction;
  if (input.includeCurrentAudience) {
    return { result, affectedScopes: await scopesForGeneralAction(store, action) };
  }
  const ownerUserId = action.ownerUserId;
  return {
    result,
    affectedScopes: [
      {
        kind: "viewer-collection",
        collection: "general-actions",
        viewerUserId: ownerUserId,
      },
      {
        kind: "viewer-entity",
        entity: "general-action",
        entityId: action.id,
        viewerUserId: ownerUserId,
      },
      { kind: "owner-collection", collection: "today", ownerUserId },
      { kind: "owner-collection", collection: "review", ownerUserId },
    ],
  };
}

async function listGeneralActionViewerUserIds(
  store: GeneralActionLifecycleStore,
  action: GeneralAction,
): Promise<string[]> {
  const viewerUserIds = new Set([action.ownerUserId]);
  if (!action.householdId || action.scope === "private") {
    return [...viewerUserIds];
  }

  if (action.scope === "household") {
    const memberships = await store.listHouseholdMemberships({
      householdId: action.householdId,
      status: "active",
    });
    for (const membership of memberships) viewerUserIds.add(membership.userId);
    return [...viewerUserIds];
  }

  const shares = await store.listHouseholdRecordShares({
    householdId: action.householdId,
    recordKind: "general_action",
    recordId: action.id,
  });
  for (const share of shares) viewerUserIds.add(share.sharedWithUserId);
  return [...viewerUserIds];
}
