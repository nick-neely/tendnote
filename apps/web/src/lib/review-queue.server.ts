import { listAssetReviewGroups } from "@tendnote/db/queries/assets";
import { listSuggestedGeneralActionReviews } from "@tendnote/db/queries/general-actions";
import { listSuggestedMemoryReviews } from "@tendnote/db/queries/memories";
import { toAssetReviewGroupViewWithOrigin } from "@/lib/asset-review-origin";
import {
  loadReviewQueue,
  type ReviewQueue,
  type ReviewQueueDependencies,
  type ReviewQueueItem,
} from "@/lib/review-queue";
import { toSuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import { toSuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

const dependencies: ReviewQueueDependencies = {
  async loadMemories({ ownerUserId, limit }) {
    const reviews = await listSuggestedMemoryReviews({ ownerUserId, limit });
    return reviews.map(
      (review): ReviewQueueItem => ({
        family: "suggested-memory",
        id: review.memory.id,
        review: toSuggestedMemoryReviewView(review),
      }),
    );
  },
  async loadGeneralActions({ ownerUserId, limit }) {
    const reviews = await listSuggestedGeneralActionReviews({ ownerUserId, limit });
    return reviews.map(
      (review): ReviewQueueItem => ({
        family: "suggested-general-action",
        id: review.action.id,
        review: toSuggestedGeneralActionReviewView(review, { callerUserId: ownerUserId }),
      }),
    );
  },
  async loadAssetGroups({ ownerUserId, limit }) {
    const groups = await listAssetReviewGroups({ ownerUserId, limit });
    return Promise.all(
      groups.map(
        async (group): Promise<ReviewQueueItem> => ({
          family: "asset-review-group",
          id: group.group.id,
          review: await toAssetReviewGroupViewWithOrigin(group),
        }),
      ),
    );
  },
};

/** Loads the complete bounded Review Queue for one admitted owner. */
export async function loadOwnerReviewQueue(ownerUserId: string): Promise<ReviewQueue> {
  const queue = await loadReviewQueue({ ownerUserId }, dependencies);

  if (queue.failures.length > 0 && process.env.NODE_ENV !== "production") {
    console.warn(`Unable to load Review Queue families: ${queue.failures.join(", ")}.`);
  }

  return queue;
}
