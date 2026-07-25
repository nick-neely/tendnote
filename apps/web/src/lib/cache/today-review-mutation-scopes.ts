import { revalidatePath, updateTag } from "next/cache";
import { todayReviewCacheContract } from "./today-review-views";

export type TodayReviewMutationScope = {
  kind: "today-owner" | "review-owner";
  ownerUserId: string;
};

export function invalidateTodayOwner(ownerUserId: string): TodayReviewMutationScope[] {
  const scopes: TodayReviewMutationScope[] = [
    { kind: "today-owner", ownerUserId },
    { kind: "review-owner", ownerUserId },
  ];
  for (const scope of scopes) {
    const tags =
      scope.kind === "today-owner"
        ? [`today:owner:${ownerUserId}`, `today:owner:${ownerUserId}:shortlist`]
        : todayReviewCacheContract.review({ ownerUserId }).tags;
    for (const tag of tags) updateTag(tag);
  }
  revalidatePath("/");
  return scopes;
}

/** Expire only the owner-scoped Review projection after any review-producing write. */
export function invalidateReviewOwner(ownerUserId: string): TodayReviewMutationScope[] {
  const scope: TodayReviewMutationScope = { kind: "review-owner", ownerUserId };
  for (const tag of todayReviewCacheContract.review({ ownerUserId }).tags) updateTag(tag);
  revalidatePath("/");
  return [scope];
}
