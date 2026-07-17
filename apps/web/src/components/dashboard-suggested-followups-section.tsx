"use client";

import { CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import {
  acceptSuggestedFollowupAction,
  dismissSuggestedFollowupAction,
} from "@/app/actions/suggested-followups";
import { Button } from "@/components/ui/button";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";
import { useResolvingAction } from "@/lib/use-resolving-action";

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
}: {
  reviews: SuggestedFollowupReviewView[];
  onResolve: (followupId: string) => void;
  heading?: string;
  headingAction?: React.ReactNode;
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
            <ReviewRow key={review.followup.id} onResolve={onResolve} review={review} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReviewRow({
  review,
  onResolve,
}: {
  review: SuggestedFollowupReviewView;
  onResolve: (followupId: string) => void;
}) {
  const { followup } = review;
  const personName = review.personName ?? "Someone";
  const { leaving, error, pending, run } = useResolvingAction(() => onResolve(followup.id));

  return (
    <li
      className="flex flex-col gap-2.5 px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
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
          onClick={() => run(() => dismissSuggestedFollowupAction({ followupId: followup.id }))}
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
          onClick={() => run(() => acceptSuggestedFollowupAction({ followupId: followup.id }))}
          size="sm"
          type="button"
        >
          <CheckIcon />
          Accept
        </Button>
      </div>

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
