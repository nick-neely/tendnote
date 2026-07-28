import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { actionCacheContract } from "./action-views";
import { todayReviewCacheContract } from "./today-review-views";

export type ReconciliationOrigin = "background" | "owner-action";

/**
 * Translates framework-neutral mutation scopes into Next.js cache effects.
 *
 * Direct owner actions synchronously expire tags for read-your-writes. Background
 * writers preserve truthful stale content while the same scopes refresh.
 */
export function reconcileAffectedScopes(
  scopes: readonly AffectedScope[],
  input: { origin: ReconciliationOrigin },
) {
  const tags = new Set(scopes.flatMap(tagsForAffectedScope));
  for (const tag of tags) {
    if (input.origin === "owner-action") updateTag(tag);
    else revalidateTag(tag, "max");
  }

  // These route calls remain the ADR-0206 migration safety net until the final
  // tag-coverage ticket proves they are redundant.
  if (input.origin === "owner-action" && scopes.length > 0) {
    revalidatePath("/actions");
    revalidatePath("/actions/today");
    revalidatePath("/");
  }
}

export function tagsForAffectedScope(scope: AffectedScope): readonly string[] {
  if (scope.kind === "viewer-collection") {
    return actionCacheContract.owner(scope.viewerUserId).tags;
  }
  if (scope.kind === "viewer-entity") {
    return [actionCacheContract.entity(scope.viewerUserId, scope.entityId)];
  }
  if (scope.collection === "today") {
    return todayReviewCacheContract.todayOwnerTags(scope.ownerUserId);
  }
  return todayReviewCacheContract.review({ ownerUserId: scope.ownerUserId }).tags;
}
