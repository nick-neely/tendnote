"use client";

import type { ContextFactView } from "@tendnote/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  AcceptSuggestedContextFactActionInput,
  SuggestedContextFactMutationResult,
} from "@/app/actions/context-fact-review";
import { acceptSuggestedContextFactAction as defaultAcceptSuggestedContextFactAction } from "@/app/actions/context-fact-review";
import { ContextFactImportStep } from "@/components/account/context-fact-import-step";
import { SuggestedContextFactReviewCard } from "@/components/suggested-context-fact-review";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { SelfContextImportView } from "@/lib/context-fact-import-view";
import {
  contextFactImportEmptyHint,
  contextFactImportHeadline,
  contextFactImportNotes,
  contextFactImportSourceNote,
} from "@/lib/context-fact-import-view";
import type { SuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";

type AcceptAction = (
  input: AcceptSuggestedContextFactActionInput,
) => Promise<SuggestedContextFactMutationResult>;

/**
 * What the import did, in the owner's terms. Focus lands here when results arrive,
 * which is also what announces it, so none of this is repeated into a live region.
 */
function ImportSummary({
  ref,
  summary,
}: {
  ref: React.Ref<HTMLDivElement>;
  summary: SelfContextImportView["summary"];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 outline-none" ref={ref} tabIndex={-1}>
      <p className="break-words text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium">
        {contextFactImportHeadline(summary)}
      </p>
      <p className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        {contextFactImportSourceNote(summary)}
      </p>
      {contextFactImportNotes(summary).map((note) => (
        <p
          className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
          key={note}
        >
          {note}
        </p>
      ))}
    </div>
  );
}

/** Nothing left to review reads differently from nothing arrived, so they are named apart. */
function emptyReviewCopy(imported: SelfContextImportView) {
  const broughtSomething =
    imported.summary.suggestedCount > 0 || imported.summary.alreadyPendingCount > 0;
  return broughtSomething
    ? {
        title: "Nothing left to review.",
        description: "You have reviewed everything this import brought over.",
      }
    : {
        title: "No facts came through.",
        description: contextFactImportEmptyHint(imported.summary),
      };
}

/**
 * What one import brought over, and the decisions still open on it.
 *
 * Nothing here is context yet. Every row is a `suggested` fact that stays out of
 * Eve's orientation until the owner keeps it, so this step is the review gate the
 * Phase 7.5 contract requires of imported facts, not a confirmation screen.
 */
export function ContextFactImportReview({
  acceptAction = defaultAcceptSuggestedContextFactAction,
  backHref,
  backLabel,
  imported,
  onAnnounce,
}: {
  acceptAction?: AcceptAction;
  backHref: string;
  backLabel: string;
  imported: SelfContextImportView;
  onAnnounce: (message: string) => void;
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState<SuggestedContextFactReviewView[]>(imported.reviews);
  const [keepingRest, setKeepingRest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  /** Every review already settled, so a bulk pass never resubmits one. */
  const resolved = useRef(new Set<string>());

  // Reading is the moment the page changes shape, so the reader is moved to what
  // arrived rather than left at the button they pressed. Moving focus onto the
  // summary is also what announces it, which is why it is not sent to the live region.
  useEffect(() => {
    setReviews(imported.reviews);
    setError(null);
    const frame = window.requestAnimationFrame(() => summaryRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [imported]);

  const keepable = reviews.filter((review) => review.activeMatch === null);

  function removeReview(contextFactId: string) {
    resolved.current.add(contextFactId);
    setReviews((current) => current.filter((review) => review.fact.id !== contextFactId));
  }

  async function keepRest() {
    if (keepingRest) return;
    setKeepingRest(true);
    setError(null);

    let kept = 0;
    let unresolved = 0;
    for (const review of keepable) {
      // A card whose own accept or dismiss landed while this loop was working is
      // already settled. Submitting for it would fail on a stale timestamp and be
      // counted as a failure the owner has to chase, when they had in fact handled it.
      if (resolved.current.has(review.fact.id)) continue;
      try {
        const result = await acceptAction({
          contextFactId: review.fact.id,
          expectedUpdatedAt: review.fact.updatedAt.toISOString(),
        });
        if (result.ok) {
          kept += 1;
          removeReview(review.fact.id);
        } else {
          unresolved += 1;
        }
      } catch {
        unresolved += 1;
      }
    }

    setKeepingRest(false);
    const keptLabel = `Kept ${kept} ${kept === 1 ? "fact" : "facts"}.`;
    onAnnounce(unresolved === 0 ? keptLabel : `${keptLabel} ${unresolved} still needs you.`);
    if (unresolved > 0) {
      setError("Some facts could not be kept. They are still below, so try them one at a time.");
    }
    router.refresh();
  }

  return (
    <ContextFactImportStep
      description="Nothing here is part of About you until you keep it. Edit anything that is not quite right."
      headingId="context-fact-import-review-heading"
      step={3}
      title="Keep what fits"
    >
      <ImportSummary ref={summaryRef} summary={imported.summary} />

      {reviews.length === 0 ? (
        <EmptyState
          action={
            <Button asChild variant="outline">
              <Link href={backHref}>{backLabel}</Link>
            </Button>
          }
          {...emptyReviewCopy(imported)}
        />
      ) : (
        <>
          <ul className="flex min-w-0 flex-col gap-2" data-context-fact-import-reviews>
            {reviews.map((review) => (
              <li key={review.fact.id}>
                <SuggestedContextFactReviewCard
                  acceptAction={acceptAction}
                  disabled={keepingRest}
                  onAccepted={(fact: ContextFactView) => onAnnounce(`Kept: ${fact.content}`)}
                  onResolve={removeReview}
                  review={review}
                />
              </li>
            ))}
          </ul>
          {/* Bulk keep covers only the facts with nothing to weigh. Anything that
              duplicates or contradicts an active fact stays a decision the owner
              makes with the existing fact in front of them. */}
          {keepable.length >= 2 ? (
            <Button
              className="min-h-11 w-full sm:w-fit"
              disabled={keepingRest}
              onClick={() => void keepRest()}
              type="button"
              variant="outline"
            >
              {keepingRest ? "Keeping…" : `Keep the ${keepable.length} without conflicts`}
            </Button>
          ) : null}
        </>
      )}

      {error ? (
        <p
          className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </ContextFactImportStep>
  );
}
