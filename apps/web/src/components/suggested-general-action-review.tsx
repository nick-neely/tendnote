"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  acceptSuggestedGeneralActionAction,
  dismissSuggestedGeneralActionAction,
  editSuggestedGeneralActionAction,
  ignoreSuggestedGeneralActionAction,
  restoreDismissedSuggestedGeneralActionAction,
} from "@/app/actions/suggested-general-actions";
import { ActionContextChip, ActionRoutineChip } from "@/components/general-action-shared";
import { CheckIcon, FolderIcon, MoonIcon } from "@/components/icons";
import { RecordTimingChip } from "@/components/record-timing-chip";
import {
  MutationFeedback,
  MutationUndo,
  SuggestionReviewControls,
} from "@/components/suggestion-review-controls";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VisibilityStatus } from "@/components/visibility-affordance";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import {
  REVERSIBLE_MUTATION_TRANSITION_MS,
  ReversibleMutationProvider,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";
import { sourceLabel } from "@/lib/source-labels";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import { suggestedGeneralActionDismissAdapter } from "@/lib/suggestion-reversible-mutation";

function formatCaptured(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * A reviewable Suggested General Action (ADRs 0151, 0152). A proposal is tentative
 * until accepted: the user can accept it (promoting it in place to a durable Action, a
 * Routine when it carries a cadence), edit the title, notes, or timing first, dismiss it
 * (a rejection that lands in the resolved trail), or ignore it (a quiet set-aside). The
 * proposal's editable metadata and its source grounding are shown so it reads as
 * trustworthy, and every action flows through the shared owner-scoped review mutations.
 * Calm register: nothing becomes an active Action until accepted, and both dismiss and
 * ignore leave without guilt (DESIGN.md §2). Used on the Actions surface and the
 * dashboard Review tab; each owns its own list state and passes the resolve callback.
 */
// A cohesive review card with an inline edit mode and four owner-scoped review actions.
// Its cognitive score is JSX composition depth plus the edit-draft/lifecycle hook set, not
// branching logic (cyclomatic is within threshold); splitting the calm card markup further
// would fragment a single reviewable unit without reducing real complexity.
// fallow-ignore-next-line complexity
export function SuggestedGeneralActionReviewCard({
  ...props
}: {
  review: SuggestedGeneralActionReviewView;
  onResolve: (generalActionId: string) => void;
  onUpdate?: (view: SuggestedGeneralActionReviewView) => void;
}) {
  return (
    <ReversibleMutationProvider>
      <SuggestedGeneralActionReviewCardContent {...props} />
    </ReversibleMutationProvider>
  );
}

// fallow-ignore-next-line complexity -- One review card coordinates its edit draft and two mutation intents; the extracted controls and adapters keep domain/UI seams separate.
function SuggestedGeneralActionReviewCardContent({
  review,
  onResolve,
  onUpdate,
}: {
  review: SuggestedGeneralActionReviewView;
  onResolve: (generalActionId: string) => void;
  onUpdate?: (view: SuggestedGeneralActionReviewView) => void;
}) {
  const router = useRouter();
  const { action, areaName, source } = review;
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(action.title);
  const [draftNotes, setDraftNotes] = useState(action.notes ?? "");
  const [draftDate, setDraftDate] = useState(action.dueAtDate);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const dismissMutation = useReversibleMutation(action.id, "dismiss");
  const pendingMutation = useReversibleMutation(action.id, "pending");
  const activeMutation = useActiveReversibleMutation(action.id, ["dismiss", "pending"]);
  const pending = Boolean(activeMutation?.state.pending);
  const leaving = Boolean(activeMutation?.state.leaving);
  const error = activeMutation?.state.error ?? null;

  // Opening edit mode moves focus straight to the title so the edit is keyboard-first
  // (DESIGN.md: full keyboard operability), not left on the pencil button behind the form.
  useEffect(() => {
    if (isEditing) {
      titleInputRef.current?.focus();
    }
  }, [isEditing]);

  // What Accept produces, so the card names its own destination — the rail card has no
  // parent intro copy to lean on.
  const destination = action.isRoutine ? "routine" : "action";

  const trimmedTitle = draftTitle.trim();
  const trimmedNotes = draftNotes.trim();
  const titleChanged = trimmedTitle !== action.title;
  const notesChanged = trimmedNotes !== (action.notes ?? "");
  const dateChanged = draftDate !== action.dueAtDate;
  const editChanged = titleChanged || notesChanged || dateChanged;

  function buildEdit() {
    return {
      ...(titleChanged && trimmedTitle ? { title: trimmedTitle } : {}),
      ...(notesChanged ? { notes: trimmedNotes ? trimmedNotes : null } : {}),
      ...(dateChanged ? { dueAt: draftDate ? draftDate : null } : {}),
    };
  }

  function resolveCard() {
    const row = dismissButtonRef.current?.closest<HTMLElement>("[data-suggestion-review-row]");
    const logicalRow = row?.closest("li") ?? row;
    const moveFocus = captureFocusAfterRemoval(logicalRow);
    onResolve(action.id);
    moveFocus();
    return true;
  }

  async function refreshAfter<TView>(
    command: () => Promise<OwnerActionResult<TView>>,
  ): Promise<OwnerActionResult<TView>> {
    const result = await command();
    if (result.ok) router.refresh();
    return result;
  }

  function handleAccept(focusTarget: HTMLElement) {
    pendingMutation.run({
      kind: "pending",
      apply: () => true,
      command: () =>
        refreshAfter(() =>
          acceptSuggestedGeneralActionAction({
            generalActionId: action.id,
            edit: isEditing ? buildEdit() : {},
          }),
        ),
      focusTarget,
      labels: pendingLabels(`Adding ${destination}…`, `${destination} added.`),
      leave: { afterMs: REVERSIBLE_MUTATION_TRANSITION_MS, apply: resolveCard },
    });
  }

  function handleDismiss() {
    dismissMutation.run({
      kind: "optimistic",
      adapter: suggestedGeneralActionDismissAdapter(() =>
        restoreDismissedSuggestedGeneralActionAction({ generalActionId: action.id }),
      ),
      apply: (view) => {
        onUpdate?.(view);
        return true;
      },
      command: () =>
        refreshAfter(() => dismissSuggestedGeneralActionAction({ generalActionId: action.id })),
      focusTarget: () => dismissButtonRef.current,
      labels: {
        pending: "Dismissing suggested action…",
        success: "Suggested action dismissed. Undo available.",
        rollback: "The suggested action was restored after dismissal failed.",
        undo: "Undo Dismiss",
        undone: "Suggested action restored to review.",
      },
      leave: { apply: resolveCard },
      prior: review,
    });
  }

  function handleIgnore(focusTarget: HTMLElement) {
    pendingMutation.run({
      kind: "pending",
      apply: () => true,
      command: () =>
        refreshAfter(() => ignoreSuggestedGeneralActionAction({ generalActionId: action.id })),
      focusTarget,
      labels: pendingLabels("Setting suggestion aside…", "Suggestion set aside."),
      leave: { afterMs: REVERSIBLE_MUTATION_TRANSITION_MS, apply: resolveCard },
    });
  }

  function handleApplyEdit(focusTarget: HTMLElement) {
    if (!trimmedTitle || !editChanged) {
      return;
    }
    pendingMutation.run({
      kind: "pending",
      apply: (updated) => {
        onUpdate?.(updated);
        setDraftTitle(updated.action.title);
        setDraftNotes(updated.action.notes ?? "");
        setDraftDate(updated.action.dueAtDate);
        setIsEditing(false);
        return true;
      },
      command: () =>
        editSuggestedGeneralActionAction({
          generalActionId: action.id,
          edit: buildEdit(),
        }),
      focusTarget,
      labels: pendingLabels("Updating suggested action…", "Suggested action updated."),
    });
  }

  function handleCancelEdit() {
    setDraftTitle(action.title);
    setDraftNotes(action.notes ?? "");
    setDraftDate(action.dueAtDate);
    setIsEditing(false);
  }

  return (
    <div className="contents" data-suggestion-review-row>
      <article
        aria-busy={pending}
        className="flex flex-col gap-3 rounded-lg border border-accent/25 bg-accent-soft/45 p-3.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
        data-leaving={leaving}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            Suggested action
          </span>
          {action.isRoutine ? (
            <ActionRoutineChip label={action.recurrenceLabel ?? "Repeats"} />
          ) : null}
        </div>

        {isEditing ? (
          <div className="flex flex-col gap-2.5">
            <Input
              aria-label="Action title"
              onChange={(event) => setDraftTitle(event.target.value)}
              ref={titleInputRef}
              value={draftTitle}
            />
            <Textarea
              aria-label="Notes"
              className="min-h-[3.5rem]"
              onChange={(event) => setDraftNotes(event.target.value)}
              placeholder="Notes (optional)"
              value={draftNotes}
            />
            {/* Clearable, unlike the follow-up card's picker: an action's due date
                is genuinely optional (`dueAt: null`), so clearing it is a real edit
                rather than a value the accept path would reject. */}
            <DatePicker
              aria-label="Proposed due date"
              className="w-44"
              onChange={setDraftDate}
              value={draftDate}
            />
            {/* Be honest about the edit's reach: the review card edits the basics; area,
              scope, links, and people are set on the action itself after you accept. */}
            <p className="text-[length:var(--text-caption)] text-muted-foreground">
              Editing the basics. Set the area, visibility, links, and people after you accept.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="max-w-[68ch] text-pretty font-medium text-[length:var(--text-body)] leading-[var(--text-body-line)]">
              {action.title}
            </p>
            {action.notes ? (
              <p className="max-w-[68ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                {action.notes}
              </p>
            ) : null}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <RecordTimingChip label={action.surfaceLabel} state={action.surfaceState} />
              {areaName ? (
                <span className="inline-flex items-center gap-1 font-mono text-[length:var(--text-caption)] text-muted-foreground">
                  <FolderIcon aria-hidden className="size-3" />
                  {areaName}
                </span>
              ) : null}
              {/* A household-native record has no audience anyone chose, so naming
                  one would invent a sharing decision nobody made (ADR 0214). */}
              {action.ownership === "household_native" ? null : (
                <VisibilityStatus scope={action.scope} selectedCount={action.sharedWithCount} />
              )}
            </div>
            {action.linkedPeople.length > 0 || action.assetHints.length > 0 ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {action.linkedPeople.map((person) => (
                  <ActionContextChip key={person.id} kind="person">
                    {person.displayName}
                  </ActionContextChip>
                ))}
                {action.assetHints.map((hint) => (
                  <ActionContextChip key={hint.label} kind="asset">
                    {hint.label}
                  </ActionContextChip>
                ))}
              </div>
            ) : null}
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

        <div className="flex flex-col gap-2 border-t border-accent/20 pt-3">
          {!isEditing ? (
            // Name the destination and disclose what each set-aside does, so a proposal is
            // never resolved blind — the softer-looking Ignore is actually the one with no
            // undo, so its consequence is spelled out (calm, not alarming).
            <p className="text-[length:var(--text-caption)] text-muted-foreground">
              Accept adds this {destination} to your Actions. Dismiss keeps it in Resolved to reopen
              later; Ignore clears it.
            </p>
          ) : null}
          {/* biome-ignore lint/a11y/useSemanticElements: a related-controls group, not a form fieldset */}
          <div
            aria-label="Review this suggested action"
            className="flex flex-wrap items-center justify-end gap-1.5"
            role="group"
          >
            {isEditing ? (
              <>
                <Button onClick={handleCancelEdit} size="sm" type="button" variant="ghost">
                  Cancel
                </Button>
                <Button
                  disabled={pending || !trimmedTitle || !editChanged}
                  onClick={(event) => handleApplyEdit(event.currentTarget)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Apply edit
                </Button>
                <Button
                  disabled={pending || !trimmedTitle}
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
                <Button
                  aria-label={`Ignore suggested action: ${action.title}`}
                  className="text-muted-foreground"
                  disabled={pending}
                  onClick={(event) => handleIgnore(event.currentTarget)}
                  size="sm"
                  title="Clears it from your lists. A later note could suggest it again."
                  type="button"
                  variant="ghost"
                >
                  <MoonIcon />
                  Ignore
                </Button>
                <SuggestionReviewControls
                  dismissButtonRef={dismissButtonRef}
                  dismissLabel={`Dismiss suggested action: ${action.title}`}
                  dismissTitle="Keeps it in your Resolved list, where you can reopen it."
                  onAccept={handleAccept}
                  onDismiss={handleDismiss}
                  onEdit={() => setIsEditing(true)}
                  pending={pending}
                />
              </>
            )}
          </div>
        </div>

        <MutationFeedback
          error={error}
          pendingLabel={pending ? (activeMutation?.state.labels.pending ?? null) : null}
        />
      </article>
      <MutationUndo requestUndo={dismissMutation.requestUndo} state={dismissMutation.state} />
    </div>
  );
}

function pendingLabels(pending: string, success: string) {
  return {
    pending,
    success,
    rollback: "The suggested action was not changed.",
    undo: "",
    undone: "",
  };
}
