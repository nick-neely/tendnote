import type { OwnerActionResult } from "@/lib/owner-action-result";
import type { ReversibleMutationAdapter } from "@/lib/reversible-mutation";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import type { SuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

/**
 * Dismissal projects through the module's leaving phase; the review view itself
 * stays exact until the authoritative command settles or rolls back.
 */
export function suggestedGeneralActionDismissAdapter(
  restore: () => Promise<OwnerActionResult<SuggestedGeneralActionReviewView>>,
): ReversibleMutationAdapter<SuggestedGeneralActionReviewView> {
  return {
    project: (prior) => prior,
    inverse: () => restore(),
  };
}

export function suggestedFollowupDismissAdapter(
  restore: () => Promise<OwnerActionResult<SuggestedFollowupReviewView>>,
): ReversibleMutationAdapter<SuggestedFollowupReviewView> {
  return {
    project: (prior) => prior,
    inverse: () => restore(),
  };
}

export function suggestedMemoryDismissAdapter(
  restore: () => Promise<OwnerActionResult<SuggestedMemoryReviewView>>,
): ReversibleMutationAdapter<SuggestedMemoryReviewView> {
  return {
    project: (prior) => prior,
    inverse: () => restore(),
  };
}
