import type { Followup } from "@tendnote/domain";
import type { AffectedScope, MutationOutcome } from "../affected-scopes";
import { affectedScopesForPerson } from "../people/affected-scopes";
import { createFollowupLifecycle } from "./lifecycle";
import { createSuggestedFollowupReview } from "./review";
import type { FollowupLifecycleStore, SuggestedFollowupReviewResult } from "./types";

/** Adds affected scopes to every active Follow-Up lifecycle mutation. */
export function createAffectedFollowupLifecycle(store: FollowupLifecycleStore) {
  const lifecycle = createFollowupLifecycle(store);

  const withAffectedScopes = (resultPromise: Promise<Followup>) =>
    followupOutcome(store, resultPromise, false);

  return {
    ...lifecycle,
    createFollowup: (input: Parameters<typeof lifecycle.createFollowup>[0]) =>
      withAffectedScopes(lifecycle.createFollowup(input)),
    editFollowup: (input: Parameters<typeof lifecycle.editFollowup>[0]) =>
      withAffectedScopes(lifecycle.editFollowup(input)),
    completeFollowup: (input: Parameters<typeof lifecycle.completeFollowup>[0]) =>
      withAffectedScopes(lifecycle.completeFollowup(input)),
    dismissFollowup: (input: Parameters<typeof lifecycle.dismissFollowup>[0]) =>
      withAffectedScopes(lifecycle.dismissFollowup(input)),
    reopenFollowup: (input: Parameters<typeof lifecycle.reopenFollowup>[0]) =>
      withAffectedScopes(lifecycle.reopenFollowup(input)),
    archiveFollowup: (input: Parameters<typeof lifecycle.archiveFollowup>[0]) =>
      withAffectedScopes(lifecycle.archiveFollowup(input)),
    snoozeFollowup: (input: Parameters<typeof lifecycle.snoozeFollowup>[0]) =>
      withAffectedScopes(lifecycle.snoozeFollowup(input)),
  };
}

/** Adds affected scopes to every Suggested Follow-Up review mutation. */
export function createAffectedSuggestedFollowupReview(store: FollowupLifecycleStore) {
  const review = createSuggestedFollowupReview(store);

  async function withReviewScopes<TResult extends Followup | SuggestedFollowupReviewResult>(
    resultPromise: Promise<TResult>,
  ): Promise<MutationOutcome<TResult>> {
    const result = await resultPromise;
    const followup =
      "component" in result
        ? (result as SuggestedFollowupReviewResult).followup
        : (result as Followup);
    return {
      result,
      affectedScopes: await affectedScopesForFollowup(store, followup, true),
    };
  }

  return {
    ...review,
    suggestFollowup: (input: Parameters<typeof review.suggestFollowup>[0]) =>
      withReviewScopes(review.suggestFollowup(input)),
    acceptSuggestedFollowup: (input: Parameters<typeof review.acceptSuggestedFollowup>[0]) =>
      withReviewScopes(review.acceptSuggestedFollowup(input)),
    editSuggestedFollowup: (input: Parameters<typeof review.editSuggestedFollowup>[0]) =>
      withReviewScopes(review.editSuggestedFollowup(input)),
    dismissSuggestedFollowup: (input: Parameters<typeof review.dismissSuggestedFollowup>[0]) =>
      withReviewScopes(review.dismissSuggestedFollowup(input)),
  };
}

async function followupOutcome(
  store: FollowupLifecycleStore,
  resultPromise: Promise<Followup>,
  includeReview: boolean,
): Promise<MutationOutcome<Followup>> {
  const result = await resultPromise;
  return {
    result,
    affectedScopes: await affectedScopesForFollowup(store, result, includeReview),
  };
}

async function affectedScopesForFollowup(
  store: FollowupLifecycleStore,
  followup: Followup,
  includeReview: boolean,
): Promise<AffectedScope[]> {
  const viewerUserIds = new Set([followup.ownerUserId]);
  if (followup.householdId && followup.scope === "household") {
    const memberships = await store.listHouseholdMemberships({
      householdId: followup.householdId,
      status: "active",
    });
    for (const membership of memberships) viewerUserIds.add(membership.userId);
  } else if (followup.householdId && followup.scope === "shared") {
    const shares = await store.listHouseholdRecordShares({
      householdId: followup.householdId,
      recordKind: "followup",
      recordId: followup.id,
    });
    for (const share of shares) viewerUserIds.add(share.sharedWithUserId);
  }

  return [
    ...affectedScopesForPerson({
      ownerUserId: followup.ownerUserId,
      personId: followup.personId,
    }),
    ...[...viewerUserIds].map(
      (ownerUserId): AffectedScope => ({
        kind: "owner-collection",
        collection: "today",
        ownerUserId,
      }),
    ),
    ...(includeReview
      ? ([
          {
            kind: "owner-collection",
            collection: "review",
            ownerUserId: followup.ownerUserId,
          },
        ] satisfies AffectedScope[])
      : []),
  ];
}
