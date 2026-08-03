import { listAssetReviewGroups } from "@tendnote/db/queries/assets";
import { listSuggestedContextFactReviews } from "@tendnote/db/queries/context-facts";
import { listSuggestedGeneralActionReviews } from "@tendnote/db/queries/general-actions";
import { listSuggestedMemoryReviews } from "@tendnote/db/queries/memories";
import { listSourceRecordReviews } from "@tendnote/db/queries/source-records";
import { toAssetReviewGroupViewWithOrigin } from "@/lib/asset-review-origin";
import {
  loadReviewQueue,
  type ReviewQueue,
  type ReviewQueueDependencies,
  type ReviewQueueFamily,
  type ReviewQueueItem,
} from "@/lib/review-queue";
import { toSourceRecordReviewView } from "@/lib/source-record-review-view";
import { toSuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";
import { toSuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import { toSuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

/**
 * Names the caller the Context Fact gate checks against.
 *
 * Every family here is handed an `ownerUserId` its caller already resolved
 * through `requireAdmittedOwner`, and the four other loaders simply trust it.
 * This one has to say so out loud because the Context Fact queries take a
 * verifier rather than a bare id.
 *
 * It must not re-derive the caller from the request. Family loads run inside the
 * `"use cache"` body in `lib/cache/today-review-views.ts`, where `headers()`
 * throws — so reaching for the session here did not tighten the gate, it made
 * every load throw and left Self Context permanently absent from Review.
 */
function reviewQueueCaller(ownerUserId: string) {
  return async () => ownerUserId;
}

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
  async loadSourceRecords({ ownerUserId, limit }) {
    const reviews = await listSourceRecordReviews({ ownerUserId, limit });
    return reviews
      .filter((review) => (review.unresolvedMentions?.length ?? 0) > 0)
      .map(
        (review): ReviewQueueItem => ({
          family: "source-record",
          id: review.sourceRecord.id,
          review: toSourceRecordReviewView(review),
        }),
      );
  },
  async loadContextFacts({ ownerUserId, limit }) {
    const reviews = await listSuggestedContextFactReviews(
      { callerUserId: ownerUserId },
      reviewQueueCaller(ownerUserId),
    );
    return reviews.slice(0, limit).map(
      (review): ReviewQueueItem => ({
        family: "suggested-context-fact",
        id: review.fact.id,
        review: toSuggestedContextFactReviewView(review),
      }),
    );
  },
};

/**
 * Loads one review family without allowing a slow or unavailable sibling to
 * delay it. The aggregate queue remains available to legacy callers; the
 * dashboard uses this seam to stream each family independently.
 */
export async function loadOwnerReviewQueueFamily(
  ownerUserId: string,
  family: ReviewQueueFamily,
): Promise<{ family: ReviewQueueFamily; items: ReviewQueueItem[]; unavailable: boolean }> {
  const loader =
    family === "suggested-memory"
      ? dependencies.loadMemories
      : family === "suggested-general-action"
        ? dependencies.loadGeneralActions
        : family === "asset-review-group"
          ? dependencies.loadAssetGroups
          : family === "source-record"
            ? dependencies.loadSourceRecords
            : dependencies.loadContextFacts;
  try {
    return { family, items: await loader({ ownerUserId, limit: 6 }), unavailable: false };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Unable to load Review Queue family ${family}.`, error);
    }
    return { family, items: [], unavailable: true };
  }
}

/** Loads the complete bounded Review Queue for one admitted owner. */
export async function loadOwnerReviewQueue(ownerUserId: string): Promise<ReviewQueue> {
  const queue = await loadReviewQueue({ ownerUserId }, dependencies);

  if (queue.failures.length > 0 && process.env.NODE_ENV !== "production") {
    console.warn(`Unable to load Review Queue families: ${queue.failures.join(", ")}.`);
  }

  return queue;
}
