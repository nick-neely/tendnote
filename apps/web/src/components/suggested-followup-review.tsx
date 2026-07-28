"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  acceptSuggestedFollowupAction,
  dismissSuggestedFollowupAction,
  editSuggestedFollowupAction,
} from "@/app/actions/suggested-followups";
import { CheckIcon, PencilIcon, PenLineIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateDraft } from "@/components/use-create-draft";
import { sourceLabel } from "@/lib/source-labels";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

const GENERIC_ERROR = "That didn't go through. Try again.";

function formatCaptured(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Reviewable suggested follow-ups on the person ledger (issue #48). Each is
 * tentative until accepted: the user can accept it (promoting it to an active
 * reminder), edit the reason or proposed due date first, or dismiss it. Source
 * grounding is shown so the proposal is trustworthy, and every action flows
 * through the shared owner-scoped review mutations. Renders nothing when empty —
 * a clean queue is not worth a heading.
 */
export function SuggestedFollowupReviewSection({
  initialReviews,
}: {
  initialReviews: SuggestedFollowupReviewView[];
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState(initialReviews);

  function resolve(followupId: string) {
    setReviews((current) => current.filter((review) => review.followup.id !== followupId));
    // Keep the Follow-ups tab count honest after an accept/dismiss.
    router.refresh();
  }

  function update(view: SuggestedFollowupReviewView) {
    setReviews((current) =>
      current.map((review) => (review.followup.id === view.followup.id ? view : review)),
    );
  }

  if (reviews.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        Proposed from your notes. Nothing becomes a reminder until you accept it.
      </p>
      {reviews.map((review) => (
        <SuggestedFollowupReviewCard
          key={review.followup.id}
          onResolve={resolve}
          onUpdate={update}
          review={review}
        />
      ))}
    </div>
  );
}

// A cohesive review card with an inline edit mode and its accept/dismiss/draft actions
// (the direct sibling of SuggestedGeneralActionReviewCard). Its cognitive score is JSX
// composition depth plus the edit/draft/transition hook set, not branching logic
// (cyclomatic is within threshold); splitting the calm card markup further would
// fragment a single reviewable unit without reducing real complexity.
// fallow-ignore-next-line complexity
function SuggestedFollowupReviewCard({
  review,
  onResolve,
  onUpdate,
}: {
  review: SuggestedFollowupReviewView;
  onResolve: (followupId: string) => void;
  onUpdate: (view: SuggestedFollowupReviewView) => void;
}) {
  const { followup, source, personName, personId } = review;
  const { create: createDraft, pending: draftPending, error: draftError } = useCreateDraft();
  const [isEditing, setIsEditing] = useState(false);
  const [draftReason, setDraftReason] = useState(followup.reason);
  const [draftDate, setDraftDate] = useState(followup.dueAtDate);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmedReason = draftReason.trim();
  const reasonChanged = trimmedReason !== followup.reason;
  const dateChanged = draftDate !== followup.dueAtDate;

  function buildEdit() {
    return {
      ...(reasonChanged && trimmedReason ? { reason: trimmedReason } : {}),
      ...(dateChanged ? { dueAt: draftDate } : {}),
    };
  }

  function leaveThen(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) throw new Error(result.error);
        setLeaving(true);
        window.setTimeout(() => onResolve(followup.id), 200);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function handleAccept() {
    leaveThen(() =>
      acceptSuggestedFollowupAction({
        followupId: followup.id,
        edit: isEditing ? buildEdit() : {},
      }),
    );
  }

  function handleDismiss() {
    leaveThen(() => dismissSuggestedFollowupAction({ followupId: followup.id }));
  }

  function handleApplyEdit() {
    if (!trimmedReason || (!reasonChanged && !dateChanged)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await editSuggestedFollowupAction({
          followupId: followup.id,
          edit: buildEdit(),
        });
        if (!result.ok) throw new Error(result.error);
        onUpdate(result.view);
        setIsEditing(false);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function handleCancelEdit() {
    setDraftReason(followup.reason);
    setDraftDate(followup.dueAtDate);
    setIsEditing(false);
    setError(null);
  }

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-accent/25 bg-accent-soft/45 p-3.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          Suggested follow-up
        </span>
        {personName ? (
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            for {personName}
          </span>
        ) : null}
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2.5">
          <Input
            aria-label="Follow-up reason"
            onChange={(event) => setDraftReason(event.target.value)}
            value={draftReason}
          />
          <Input
            aria-label="Proposed due date"
            className="w-44"
            onChange={(event) => setDraftDate(event.target.value)}
            type="date"
            value={draftDate}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
            {followup.reason}
          </p>
          <p className="text-[length:var(--text-caption)] text-muted-foreground">
            Proposed for {followup.dueLabel}
          </p>
        </div>
      )}

      {source ? (
        <div className="border-t border-accent/20 pt-2.5">
          <p className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
            From {sourceLabel(source.sourceType)} · captured {formatCaptured(source.capturedAt)}
          </p>
          <p className="mt-1 line-clamp-2 max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {source.content}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-1.5 border-t border-accent/20 pt-3">
        {isEditing ? (
          <>
            <Button onClick={handleCancelEdit} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={pending || !trimmedReason || (!reasonChanged && !dateChanged)}
              onClick={handleApplyEdit}
              size="sm"
              type="button"
              variant="outline"
            >
              Apply edit
            </Button>
            <Button
              disabled={pending || !trimmedReason}
              onClick={handleAccept}
              size="sm"
              type="button"
            >
              <CheckIcon />
              Accept
            </Button>
          </>
        ) : (
          <>
            {personId ? (
              <Button
                disabled={pending || draftPending}
                onClick={() =>
                  // A review-point draft: it grounds on the suggestion's reason but
                  // never accepts it or creates follow-up state (PRD #79).
                  createDraft({
                    personId,
                    followupContext: { id: followup.id, reason: followup.reason },
                  })
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                <PenLineIcon />
                Draft
              </Button>
            ) : null}
            <Button
              aria-label="Dismiss suggested follow-up"
              disabled={pending}
              onClick={handleDismiss}
              size="sm"
              type="button"
              variant="ghost"
            >
              <XIcon />
              Dismiss
            </Button>
            <Button
              disabled={pending}
              onClick={() => setIsEditing(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <PencilIcon />
              Edit
            </Button>
            <Button disabled={pending} onClick={handleAccept} size="sm" type="button">
              <CheckIcon />
              Accept
            </Button>
          </>
        )}
      </div>

      {error || draftError ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error ?? draftError}
        </p>
      ) : null}
    </article>
  );
}
