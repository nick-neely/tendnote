import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { actionCacheContract } from "./action-views";
import { peopleCacheContract } from "./people-contract";
import { todayReviewCacheContract } from "./today-review-views";

export type ReconciliationOrigin = "background" | "owner-action";

/**
 * Translates framework-neutral mutation scopes into Next.js cache effects.
 *
 * Direct owner actions synchronously expire tags for read-your-writes. Background
 * writers preserve truthful stale content while the same scopes refresh.
 */
// fallow-ignore-next-line complexity -- This exhaustive adapter deliberately centralizes every affected-scope-to-tag-and-route branch.
export function reconcileAffectedScopes(
  scopes: readonly AffectedScope[],
  input: { origin: ReconciliationOrigin },
) {
  const tags = new Set(scopes.flatMap(tagsForAffectedScope));
  for (const tag of tags) {
    if (input.origin === "owner-action") updateTag(tag);
    else revalidateTag(tag, "max");
  }

  if (input.origin !== "owner-action") return;

  // Route calls remain the ADR-0206 migration safety net until the final
  // tag-coverage ticket proves each family is fully expressed by tags.
  const personIds = new Set<string>();
  let actions = false;
  let people = false;
  let today = false;
  let review = false;
  for (const scope of scopes) {
    if (
      scope.kind === "viewer-collection" ||
      (scope.kind === "viewer-entity" && scope.entity === "general-action")
    ) {
      actions = true;
    } else if (
      (scope.kind === "owner-collection" && scope.collection === "people") ||
      (scope.kind === "viewer-entity" && scope.entity === "person") ||
      scope.kind === "visible-entity"
    ) {
      people = true;
      if (scope.kind !== "owner-collection") personIds.add(scope.entityId);
    } else if (scope.kind === "owner-collection" && scope.collection === "today") {
      today = true;
    } else if (scope.kind === "owner-collection" && scope.collection === "review") {
      review = true;
    }
  }

  if (actions) revalidatePath("/actions");
  if (people) revalidatePath("/people");
  for (const personId of personIds) revalidatePath(`/people/${personId}`);
  if (actions || today) revalidatePath("/actions/today");
  if (today || review) revalidatePath("/");
}

export function tagsForAffectedScope(scope: AffectedScope): readonly string[] {
  if (scope.kind === "viewer-collection") {
    return actionCacheContract.owner(scope.viewerUserId).tags;
  }
  if (scope.kind === "viewer-entity") {
    return scope.entity === "general-action"
      ? [actionCacheContract.entity(scope.viewerUserId, scope.entityId)]
      : [peopleCacheContract.tags.entity(scope.viewerUserId, scope.entityId)];
  }
  if (scope.kind === "visible-entity") {
    return [peopleCacheContract.tags.allViewersEntity(scope.entityId)];
  }
  if (scope.collection === "people") {
    return [
      peopleCacheContract.tags.owner(scope.ownerUserId),
      peopleCacheContract.tags.collection(scope.ownerUserId),
    ];
  }
  if (scope.collection === "today") {
    return todayReviewCacheContract.todayOwnerTags(scope.ownerUserId);
  }
  return todayReviewCacheContract.review({ ownerUserId: scope.ownerUserId }).tags;
}
