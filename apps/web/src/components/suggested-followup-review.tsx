"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  acceptSuggestedFollowupAction,
  dismissSuggestedFollowupAction,
  editSuggestedFollowupAction,
  restoreDismissedSuggestedFollowupAction,
} from "@/app/actions/suggested-followups";
import { CheckIcon, PenLineIcon } from "@/components/icons";
import {
  MutationFeedback,
  MutationUndo,
  SuggestionReviewControls,
} from "@/components/suggestion-review-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateDraft } from "@/components/use-create-draft";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import {
  REVERSIBLE_MUTATION_TRANSITION_MS,
  ReversibleMutationProvider,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";
import { sourceLabel } from "@/lib/source-labels";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";
import { suggestedFollowupDismissAdapter } from "@/lib/suggestion-reversible-mutation";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

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
  ...props
}: {
  initialReviews: SuggestedFollowupReviewView[];
}) {
  return (
    <ReversibleMutationProvider>
      <SuggestedFollowupReviewSectionContent {...props} />
    </ReversibleMutationProvider>
  );
}

function SuggestedFollowupReviewSectionContent({
  initialReviews,
}: {
  initialReviews: SuggestedFollowupReviewView[];
}) {
  const router = useRouter();
  const [reviews, setReviews] = useServerSyncedList(initialReviews, (review) => review.followup.id);

  function resolve(followupId: string, row: HTMLElement | null) {
    const moveFocus = captureFocusAfterRemoval(row);
    setReviews((current) => current.filter((review) => review.followup.id !== followupId));
    // Keep the Follow-ups tab count honest after an accept/dismiss.
    router.refresh();
    moveFocus();
  }

  function update(view: SuggestedFollowupReviewView) {
    setReviews((current) =>
      current.some((review) => review.followup.id === view.followup.id)
        ? current.map((review) => (review.followup.id === view.followup.id ? view : review))
        : [...current, view],
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
  onResolve: (followupId: string, row: HTMLElement | null) => void;
  onUpdate: (view: SuggestedFollowupReviewView) => void;
}) {
  const { followup, source, personName, personId } = review;
  const { create: createDraft, pending: draftPending, error: draftError } = useCreateDraft();
  const [isEditing, setIsEditing] = useState(false);
  const [draftReason, setDraftReason] = useState(followup.reason);
  const [draftDate, setDraftDate] = useState(followup.dueAtDate);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const dismissMutation = useReversibleMutation(followup.id, "dismiss");
  const pendingMutation = useReversibleMutation(followup.id, "pending");
  const activeMutation = useActiveReversibleMutation(followup.id, ["dismiss", "pending"]);
  const pending = Boolean(activeMutation?.state.pending);
  const leaving = Boolean(activeMutation?.state.leaving);
  const error = activeMutation?.state.error ?? null;

  const trimmedReason = draftReason.trim();
  const reasonChanged = trimmedReason !== followup.reason;
  const dateChanged = draftDate !== followup.dueAtDate;

  function buildEdit() {
    return {
      ...(reasonChanged && trimmedReason ? { reason: trimmedReason } : {}),
      ...(dateChanged ? { dueAt: draftDate } : {}),
    };
  }

  function resolveCard(row: HTMLElement | null) {
    onResolve(followup.id, row);
    return true;
  }

  function handleAccept(focusTarget: HTMLElement) {
    const row = focusTarget.closest<HTMLElement>("[data-suggested-followup-row]");
    pendingMutation.run({
      kind: "pending",
      apply: () => true,
      command: () =>
        acceptSuggestedFollowupAction({
          followupId: followup.id,
          edit: isEditing ? buildEdit() : {},
        }),
      focusTarget,
      labels: followupPendingLabels("Adding follow-up…", "Follow-up added."),
      leave: {
        afterMs: REVERSIBLE_MUTATION_TRANSITION_MS,
        apply: () => resolveCard(row),
      },
    });
  }

  function handleDismiss() {
    const row =
      dismissButtonRef.current?.closest<HTMLElement>("[data-suggested-followup-row]") ?? null;
    dismissMutation.run({
      kind: "optimistic",
      adapter: suggestedFollowupDismissAdapter(() =>
        restoreDismissedSuggestedFollowupAction({ followupId: followup.id }),
      ),
      apply: (view) => {
        onUpdate(view);
        return true;
      },
      command: () => dismissSuggestedFollowupAction({ followupId: followup.id }),
      focusTarget: () => dismissButtonRef.current,
      labels: {
        pending: "Dismissing suggested follow-up…",
        success: "Suggested follow-up dismissed. Undo available.",
        rollback: "The suggested follow-up was restored after dismissal failed.",
        undo: "Undo Dismiss",
        undone: "Suggested follow-up restored to review.",
      },
      leave: { apply: () => resolveCard(row) },
      prior: review,
    });
  }

  function handleApplyEdit(focusTarget: HTMLElement) {
    if (!trimmedReason || (!reasonChanged && !dateChanged)) {
      return;
    }
    pendingMutation.run({
      kind: "pending",
      apply: (updated) => {
        onUpdate(updated);
        setIsEditing(false);
        return true;
      },
      command: () =>
        editSuggestedFollowupAction({
          followupId: followup.id,
          edit: buildEdit(),
        }),
      focusTarget,
      labels: followupPendingLabels(
        "Updating suggested follow-up…",
        "Suggested follow-up updated.",
      ),
    });
  }

  function handleCancelEdit() {
    setDraftReason(followup.reason);
    setDraftDate(followup.dueAtDate);
    setIsEditing(false);
  }

  return (
    <div className="contents" data-suggested-followup-row>
      <article
        aria-busy={pending}
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
                onClick={(event) => handleApplyEdit(event.currentTarget)}
                size="sm"
                type="button"
                variant="outline"
              >
                Apply edit
              </Button>
              <Button
                disabled={pending || !trimmedReason}
                onClick={(event) => handleAccept(event.currentTarget)}
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
              <SuggestionReviewControls
                dismissButtonRef={dismissButtonRef}
                dismissLabel="Dismiss suggested follow-up"
                onAccept={handleAccept}
                onDismiss={handleDismiss}
                onEdit={() => setIsEditing(true)}
                pending={pending}
              />
            </>
          )}
        </div>

        <MutationFeedback
          error={error ?? draftError}
          pendingLabel={pending ? (activeMutation?.state.labels.pending ?? null) : null}
        />
      </article>
      <MutationUndo requestUndo={dismissMutation.requestUndo} state={dismissMutation.state} />
    </div>
  );
}

function followupPendingLabels(pending: string, success: string) {
  return {
    pending,
    success,
    rollback: "The suggested follow-up was not changed.",
    undo: "",
    undone: "",
  };
}
