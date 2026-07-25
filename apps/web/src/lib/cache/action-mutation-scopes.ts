import { revalidatePath, updateTag } from "next/cache";
import { actionCacheContract } from "./action-views";
import { todayReviewCacheContract } from "./today-review-views";

export type ActionMutationScope =
  | { kind: "action-owner"; ownerUserId: string }
  | { kind: "action-entity"; ownerUserId: string; actionId: string }
  | { kind: "today-owner"; ownerUserId: string }
  | { kind: "review-owner"; ownerUserId: string };

const actionMutationScopes = {
  forAction(input: { ownerUserId: string; actionId: string }): ActionMutationScope[] {
    return [
      { kind: "action-owner", ownerUserId: input.ownerUserId },
      { kind: "action-entity", ownerUserId: input.ownerUserId, actionId: input.actionId },
      { kind: "today-owner", ownerUserId: input.ownerUserId },
      { kind: "review-owner", ownerUserId: input.ownerUserId },
    ];
  },
  tags(scope: ActionMutationScope): readonly string[] {
    if (scope.kind === "action-owner") return actionCacheContract.owner(scope.ownerUserId).tags;
    if (scope.kind === "action-entity") {
      return [actionCacheContract.entity(scope.ownerUserId, scope.actionId)];
    }
    if (scope.kind === "today-owner")
      return todayReviewCacheContract.todayOwnerTags(scope.ownerUserId);
    return todayReviewCacheContract.review({ ownerUserId: scope.ownerUserId }).tags;
  },
};

/**
 * Synchronously expires every owner projection a direct Action write can affect.
 * The route calls are deliberately retained as a migration safety net while the
 * routes move to Cache Components; the tags are the read-your-writes contract.
 */
export function invalidateActionMutation(input: {
  ownerUserId: string;
  actionId: string;
}): ActionMutationScope[] {
  const scopes = actionMutationScopes.forAction(input);
  for (const scope of scopes) {
    for (const tag of actionMutationScopes.tags(scope)) updateTag(tag);
  }
  revalidatePath("/actions");
  revalidatePath("/actions/today");
  revalidatePath("/");
  return scopes;
}
