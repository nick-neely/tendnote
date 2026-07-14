"use client";

import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { AssetReviewGroupCard } from "@/components/asset-review-group-card";
import type { AssetReviewGroupView } from "@/lib/asset-review-view";
import { cn } from "@/lib/utils";

/**
 * The asset facts Eve proposed, reviewable in the conversation (#196 story 57) — the
 * Review tab's own {@link AssetReviewGroupCard}, rendered where the proposal was made.
 * It is deliberately not a chat-shaped imitation of that card: the duplicate
 * link-to-existing prompt, edit-before-accept, per-detail accept/dismiss, the evidence
 * strip, and batch accept all come from #198 unchanged, driven by the same owner-scoped
 * server actions, so accepting here and accepting in the queue are the same act. There
 * is one review surface for an asset fact, and this is it.
 *
 * Local state tracks only what the *conversation* needs: once the group is resolved it
 * cannot be reviewed again (the card is gone from the queue too), so the transcript
 * keeps a quiet, honest line about what happened instead of a dead card offering
 * buttons that would now fail.
 */
export function ChatAssetReviewCard({
  review: initialReview,
  isNew = false,
}: {
  review: AssetReviewGroupView;
  isNew?: boolean;
}) {
  const [review, setReview] = useState(initialReview);
  const [resolved, setResolved] = useState(false);

  if (resolved) {
    return (
      <p
        className={cn(
          "flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]",
          isNew && "fade-in animate-in duration-200 ease-(--motion-ease-out)",
        )}
        data-tool-view="asset_review_group"
      >
        <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
          <CheckIcon className="size-3.5" />
        </span>
        Reviewed — nothing left pending on {review.asset.name}.
      </p>
    );
  }

  return (
    <div data-tool-view="asset_review_group">
      <AssetReviewGroupCard
        onResolve={() => setResolved(true)}
        onUpdate={setReview}
        review={review}
      />
    </div>
  );
}
