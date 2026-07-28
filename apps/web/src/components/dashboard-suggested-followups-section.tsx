"use client";

import Link from "next/link";
import {
  acceptSuggestedFollowupAction,
  dismissSuggestedFollowupAction,
  restoreDismissedSuggestedFollowupAction,
} from "@/app/actions/suggested-followups";
import { CheckIcon, XIcon } from "@/components/icons";
import { MutationFeedback, MutationUndo } from "@/components/suggestion-review-controls";
import { Button } from "@/components/ui/button";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import {
  REVERSIBLE_MUTATION_TRANSITION_MS,
  ReversibleMutationProvider,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";
import { suggestedFollowupDismissAdapter } from "@/lib/suggestion-reversible-mutation";

/**
 * Reviewable suggested follow-ups on the dashboard rail (issue #48): a small set
 * of tentative proposals the user can accept (turning one into an active reminder)
 * or dismiss inline. The full review — edit the timing first — lives on the
 * person's ledger, which the name links to. These are proposals, never active
 * reminders, until accepted.
 *
 * Controlled by the dashboard rail (see DashboardFollowupsSection): the rail owns
 * the list so the Follow-ups tab count stays in sync. Renders nothing when empty.
 */
export function DashboardSuggestedFollowupsSection({
  reviews,
  onResolve,
  heading = "Follow-ups to review",
  headingAction,
  fallbackFocusTarget,
}: {
  reviews: SuggestedFollowupReviewView[];
  onResolve: (followupId: string) => void;
  heading?: string;
  headingAction?: React.ReactNode;
  fallbackFocusTarget?: () => HTMLElement | null;
}) {
  if (reviews.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="px-1 text-[length:var(--text-small)] font-medium text-muted-foreground">
          {heading}
        </h2>
        {headingAction}
      </div>
      <div className="overflow-hidden rounded-xl border bg-surface">
        <ul className="divide-y">
          {reviews.map((review) => (
            <ReviewRow
              fallbackFocusTarget={fallbackFocusTarget}
              key={review.followup.id}
              onResolve={onResolve}
              review={review}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReviewRow({
  ...props
}: {
  review: SuggestedFollowupReviewView;
  onResolve: (followupId: string) => void;
  fallbackFocusTarget?: () => HTMLElement | null;
}) {
  return (
    <ReversibleMutationProvider>
      <ReviewRowContent {...props} />
    </ReversibleMutationProvider>
  );
}

function ReviewRowContent({
  review,
  onResolve,
  fallbackFocusTarget,
}: {
  review: SuggestedFollowupReviewView;
  onResolve: (followupId: string) => void;
  fallbackFocusTarget?: () => HTMLElement | null;
}) {
  const { followup } = review;
  const personName = review.personName ?? "Someone";
  const dismissMutation = useReversibleMutation(followup.id, "dismiss");
  const acceptMutation = useReversibleMutation(followup.id, "accept");
  const activeMutation = useActiveReversibleMutation(followup.id, ["dismiss", "accept"]);
  const { error = null, leaving = false, pending = false } = activeMutation?.state ?? {};

  function dismiss(focusTarget: HTMLElement) {
    const moveFocus = captureFocusAfterRemoval(
      focusTarget.closest<HTMLElement>("[data-dashboard-suggested-followup-row]"),
      "h2",
      fallbackFocusTarget,
    );
    dismissMutation.run({
      kind: "optimistic",
      adapter: suggestedFollowupDismissAdapter(() =>
        restoreDismissedSuggestedFollowupAction({ followupId: followup.id }),
      ),
      apply: () => true,
      command: () => dismissSuggestedFollowupAction({ followupId: followup.id }),
      focusTarget,
      labels: {
        pending: "Dismissing suggested follow-up…",
        success: "Suggested follow-up dismissed. Undo available.",
        rollback: "The suggested follow-up was restored after dismissal failed.",
        undo: "Undo Dismiss",
        undone: "Suggested follow-up restored to review.",
      },
      leave: {
        apply: () => {
          onResolve(followup.id);
          moveFocus();
          return true;
        },
      },
      prior: review,
    });
  }

  function accept(focusTarget: HTMLElement) {
    const moveFocus = captureFocusAfterRemoval(
      focusTarget.closest<HTMLElement>("[data-dashboard-suggested-followup-row]"),
      "h2",
      fallbackFocusTarget,
    );
    acceptMutation.run({
      kind: "pending",
      apply: () => true,
      command: () => acceptSuggestedFollowupAction({ followupId: followup.id }),
      focusTarget,
      labels: {
        pending: "Adding follow-up…",
        success: "Follow-up added.",
        rollback: "The follow-up was not changed.",
        undo: "",
        undone: "",
      },
      leave: {
        afterMs: REVERSIBLE_MUTATION_TRANSITION_MS,
        apply: () => {
          onResolve(followup.id);
          moveFocus();
          return true;
        },
      },
    });
  }

  return (
    <li
      aria-busy={pending}
      className="flex flex-col gap-2.5 px-4 py-3"
      data-dashboard-suggested-followup-row
    >
      <div
        className="flex flex-col gap-2.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
        data-leaving={leaving}
      >
        <div className="flex items-center justify-between gap-2">
          {review.personId ? (
            <Link
              className="min-w-0 truncate text-sm font-medium underline-offset-4 transition-colors hover:underline"
              href={`/people/${review.personId}#follow-ups`}
            >
              {personName}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-sm font-medium">{personName}</span>
          )}
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            Suggested
          </span>
        </div>

        <p className="line-clamp-3 text-pretty text-[length:var(--text-small)] leading-[var(--text-small-line)]">
          {followup.reason}
        </p>
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          Proposed for {followup.dueLabel}
        </p>

        <div className="flex items-center justify-end gap-1.5">
          <Button
            aria-label={`Dismiss suggested follow-up for ${personName}`}
            disabled={pending}
            onClick={(event) => dismiss(event.currentTarget)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
            Dismiss
          </Button>
          <Button
            aria-label={`Accept suggested follow-up for ${personName}`}
            disabled={pending}
            onClick={(event) => accept(event.currentTarget)}
            size="sm"
            type="button"
          >
            <CheckIcon />
            Accept
          </Button>
        </div>

        <MutationFeedback
          error={error}
          pendingLabel={pending ? (activeMutation?.state.labels.pending ?? null) : null}
        />
      </div>
      <MutationUndo requestUndo={dismissMutation.requestUndo} state={dismissMutation.state} />
    </li>
  );
}
