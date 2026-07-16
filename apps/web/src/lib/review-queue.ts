import type { AssetReviewGroupView } from "@/lib/asset-review-view";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import type { SuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

export const REVIEW_QUEUE_LIMIT = 6;

export type ReviewQueueFamily =
  | "suggested-memory"
  | "suggested-general-action"
  | "asset-review-group";

export type ReviewQueueIdentity = { family: ReviewQueueFamily; id: string };

export type ReviewQueueItem =
  | {
      family: "suggested-memory";
      id: string;
      review: SuggestedMemoryReviewView;
    }
  | {
      family: "suggested-general-action";
      id: string;
      review: SuggestedGeneralActionReviewView;
    }
  | {
      family: "asset-review-group";
      id: string;
      review: AssetReviewGroupView;
    };

export type ReviewQueue = {
  items: ReviewQueueItem[];
  /** One count per review unit. An Asset group is one item regardless of its members. */
  count: number;
  /** Diagnostic only: successful families remain visible when another loader fails. */
  failures: ReviewQueueFamily[];
};

type LoadFamilyInput = { ownerUserId: string; limit: number };

export type ReviewQueueDependencies = {
  loadMemories: (input: LoadFamilyInput) => Promise<ReviewQueueItem[]>;
  loadGeneralActions: (input: LoadFamilyInput) => Promise<ReviewQueueItem[]>;
  loadAssetGroups: (input: LoadFamilyInput) => Promise<ReviewQueueItem[]>;
};

/**
 * The Review Queue's owner-scoped public collection seam.
 *
 * Deletion test: removing this module would force callers to re-own cross-family
 * collection, limits, shaping, failure isolation, ordering, counts, and identity-
 * safe resolution/update behavior. Those policies belong together here.
 */
export async function loadReviewQueue(
  input: { ownerUserId: string; limit?: number },
  dependencies: ReviewQueueDependencies,
): Promise<ReviewQueue> {
  const limit = input.limit ?? REVIEW_QUEUE_LIMIT;
  const familyInput = { ownerUserId: input.ownerUserId, limit };
  const families = await Promise.allSettled([
    dependencies.loadMemories(familyInput),
    dependencies.loadGeneralActions(familyInput),
    dependencies.loadAssetGroups(familyInput),
  ]);
  const names: ReviewQueueFamily[] = [
    "suggested-memory",
    "suggested-general-action",
    "asset-review-group",
  ];
  const items = families
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .slice(0, limit);
  const failures = families.flatMap((result, index) => {
    const failedFamily = names[index];
    return result.status === "rejected" && failedFamily ? [failedFamily] : [];
  });

  return { items, count: items.length, failures };
}

function isIdentity(item: ReviewQueueItem, identity: ReviewQueueIdentity): boolean {
  return item.family === identity.family && item.id === identity.id;
}

export function resolveReviewQueueItem(
  queue: ReviewQueue,
  identity: ReviewQueueIdentity,
): ReviewQueue {
  const items = queue.items.filter((item) => !isIdentity(item, identity));
  return { ...queue, items, count: items.length };
}

export function updateReviewQueueItem(queue: ReviewQueue, update: ReviewQueueItem): ReviewQueue {
  const items = queue.items.map((item) => (isIdentity(item, update) ? update : item));
  return { ...queue, items };
}
