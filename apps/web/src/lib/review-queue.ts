import type { AssetReviewGroupView } from "@/lib/asset-review-view";
import type { SourceRecordReviewView } from "@/lib/source-record-review-view";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import type { SuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

const REVIEW_QUEUE_LIMIT = 6;

export type ReviewQueueFamily =
  | "suggested-memory"
  | "suggested-general-action"
  | "asset-review-group"
  | "source-record";

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
    }
  | {
      family: "source-record";
      id: string;
      review: SourceRecordReviewView;
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
  loadSourceRecords: (input: LoadFamilyInput) => Promise<ReviewQueueItem[]>;
};

function interleaveFamilies(
  families: PromiseSettledResult<ReviewQueueItem[]>[],
  limit: number,
): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];

  for (let familyIndex = 0; items.length < limit; familyIndex += 1) {
    let addedItem = false;

    for (const family of families) {
      if (family.status !== "fulfilled") {
        continue;
      }

      const item = family.value[familyIndex];
      if (item) {
        items.push(item);
        addedItem = true;
      }
      if (items.length === limit) {
        break;
      }
    }

    if (!addedItem) {
      break;
    }
  }

  return items;
}

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
    dependencies.loadSourceRecords(familyInput),
  ]);
  const names: ReviewQueueFamily[] = [
    "suggested-memory",
    "suggested-general-action",
    "asset-review-group",
    "source-record",
  ];
  // Stable round-robin keeps each loader's trust-aware ordering while ensuring a
  // saturated family cannot consume the calm global bound by itself.
  const items = interleaveFamilies(families, limit);
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
