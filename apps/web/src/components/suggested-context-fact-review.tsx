"use client";

import type { ContextFactView, Sensitivity } from "@tendnote/domain";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type AcceptSuggestedContextFactActionInput,
  acceptSuggestedContextFactAction,
  type DismissSuggestedContextFactActionInput,
  dismissSuggestedContextFactAction,
  type SuggestedContextFactDismissResult,
  type SuggestedContextFactMutationResult,
} from "@/app/actions/context-fact-review";
import {
  MutationFeedback,
  SuggestionReviewControls,
} from "@/components/suggestion-review-controls";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  contextFactCategoryLabel,
  contextFactProvenanceLabel,
  contextFactSensitivityLabel,
  type SelfContextCategory,
} from "@/lib/context-fact-view";
import {
  REVERSIBLE_MUTATION_TRANSITION_MS,
  ReversibleMutationProvider,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";
import type { SuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";

export type SuggestedContextFactAcceptAction = (
  input: AcceptSuggestedContextFactActionInput,
) => Promise<SuggestedContextFactMutationResult>;
export type SuggestedContextFactDismissAction = (
  input: DismissSuggestedContextFactActionInput,
) => Promise<SuggestedContextFactDismissResult>;

const sensitivityRank: Record<Sensitivity, number> = {
  normal: 0,
  sensitive: 1,
  restricted: 2,
};

const sensitivityOptions: readonly Sensitivity[] = ["normal", "sensitive", "restricted"];

export function SuggestedContextFactReviewCard(props: {
  review: SuggestedContextFactReviewView;
  onResolve: (contextFactId: string) => void;
  onAccepted?: (fact: ContextFactView) => void;
  acceptAction?: SuggestedContextFactAcceptAction;
  dismissAction?: SuggestedContextFactDismissAction;
}) {
  return (
    <ReversibleMutationProvider>
      <SuggestedContextFactReviewCardContent {...props} />
    </ReversibleMutationProvider>
  );
}

function SuggestedContextFactReviewCardContent({
  review,
  onResolve,
  onAccepted,
  acceptAction = acceptSuggestedContextFactAction,
  dismissAction = dismissSuggestedContextFactAction,
}: {
  review: SuggestedContextFactReviewView;
  onResolve: (contextFactId: string) => void;
  onAccepted?: (fact: ContextFactView) => void;
  acceptAction?: SuggestedContextFactAcceptAction;
  dismissAction?: SuggestedContextFactDismissAction;
}) {
  const { fact, evidence, activeMatch } = review;
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(fact.content);
  const [draftCategory, setDraftCategory] = useState<SelfContextCategory>(
    fact.category as SelfContextCategory,
  );
  const [draftSensitivity, setDraftSensitivity] = useState<Sensitivity>(fact.sensitivity);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflictFactId, setConflictFactId] = useState<string | null>(null);
  const editContentRef = useRef<HTMLTextAreaElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const acceptMutation = useReversibleMutation(fact.id, "accept");
  const dismissMutation = useReversibleMutation(fact.id, "dismiss");
  const activeMutation = useActiveReversibleMutation(fact.id, ["accept", "dismiss"]);
  const pending = Boolean(activeMutation?.state.pending);
  const leaving = Boolean(activeMutation?.state.leaving);

  useEffect(() => {
    if (isEditing) editContentRef.current?.focus();
  }, [isEditing]);

  function resolve(authoritative?: ContextFactView) {
    if (authoritative) onAccepted?.(authoritative);
    onResolve(fact.id);
  }

  function runAccept(
    focusTarget: HTMLElement,
    edit?: { category: SelfContextCategory; content: string; sensitivity: Sensitivity },
  ) {
    const normalizedEdit = edit
      ? {
          category: edit.category,
          content: edit.content.trim(),
          sensitivity: edit.sensitivity,
        }
      : undefined;
    if (normalizedEdit && !normalizedEdit.content) {
      setValidationError("Add a concise fact.");
      editContentRef.current?.focus();
      return;
    }

    setValidationError(null);
    setConflictFactId(null);
    acceptMutation.run({
      kind: "pending",
      apply: () => true,
      command: async () => {
        const result = await acceptAction({
          contextFactId: fact.id,
          expectedUpdatedAt: fact.updatedAt.toISOString(),
          ...(normalizedEdit ? { edit: normalizedEdit } : {}),
        });
        if (!result.ok) setConflictFactId(result.focusContextFactId ?? null);
        return result;
      },
      focusTarget,
      labels: {
        pending: normalizedEdit ? "Accepting your reviewed fact…" : "Accepting suggested fact…",
        success: "Fact accepted into About you.",
        rollback: "The suggested fact was not accepted.",
        undo: "",
        undone: "",
      },
      leave: {
        afterMs: REVERSIBLE_MUTATION_TRANSITION_MS,
        apply: (view) => {
          setIsEditing(false);
          resolve(view.fact);
          return true;
        },
      },
    });
  }

  function runDismiss() {
    setConflictFactId(null);
    dismissMutation.run({
      kind: "pending",
      apply: () => true,
      command: () =>
        dismissAction({
          contextFactId: fact.id,
          expectedUpdatedAt: fact.updatedAt.toISOString(),
        }),
      focusTarget: dismissButtonRef.current,
      labels: {
        pending: "Dismissing suggested fact…",
        success: "Suggested fact dismissed.",
        rollback: "The suggested fact was not dismissed.",
        undo: "",
        undone: "",
      },
      leave: {
        afterMs: REVERSIBLE_MUTATION_TRANSITION_MS,
        apply: () => {
          resolve();
          return true;
        },
      },
    });
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runAccept(
      event.currentTarget.querySelector<HTMLButtonElement>("[type=submit]") ??
        dismissButtonRef.current ??
        document.body,
      {
        category: draftCategory,
        content: draftContent,
        sensitivity: draftSensitivity,
      },
    );
  }

  const match = activeMatch;
  const focusedMatchId = match?.fact.id ?? conflictFactId;

  return (
    <div className="contents" data-suggestion-review-row>
      <article
        aria-busy={pending}
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-accent/25 bg-accent-soft/45 p-3.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
        data-context-fact-suggestion-id={fact.id}
        data-leaving={leaving}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
            Suggested context
          </span>
          <span className="truncate text-[length:var(--text-caption)] text-muted-foreground">
            {contextFactCategoryLabel(fact.category as SelfContextCategory)}
          </span>
        </div>

        {isEditing ? (
          <form className="flex min-w-0 flex-col gap-3" onSubmit={submitEdit}>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${fact.id}-suggested-category`}>Category</Label>
              <select
                className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                disabled={pending}
                id={`${fact.id}-suggested-category`}
                onChange={(event) => setDraftCategory(event.target.value as SelfContextCategory)}
                value={draftCategory}
              >
                <option value="background">Background</option>
                <option value="work">Work</option>
                <option value="location">Location</option>
                <option value="interest">Interest</option>
                <option value="preference">Preference</option>
                <option value="constraint">Constraint</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${fact.id}-suggested-sensitivity`}>Sensitivity</Label>
              <select
                className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                disabled={pending}
                id={`${fact.id}-suggested-sensitivity`}
                onChange={(event) => setDraftSensitivity(event.target.value as Sensitivity)}
                value={draftSensitivity}
              >
                {sensitivityOptions
                  .filter(
                    (sensitivity) =>
                      sensitivityRank[sensitivity] >= sensitivityRank[fact.sensitivity],
                  )
                  .map((sensitivity) => (
                    <option key={sensitivity} value={sensitivity}>
                      {sensitivity[0]?.toUpperCase() + sensitivity.slice(1)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${fact.id}-suggested-content`}>Suggested fact</Label>
              <Textarea
                aria-describedby={`${fact.id}-suggested-helper`}
                aria-invalid={validationError ? true : undefined}
                className="min-h-24 min-w-0 resize-y"
                disabled={pending}
                id={`${fact.id}-suggested-content`}
                maxLength={500}
                onChange={(event) => setDraftContent(event.target.value)}
                ref={editContentRef}
                value={draftContent}
              />
              <p
                className="text-[length:var(--text-small)] text-muted-foreground"
                id={`${fact.id}-suggested-helper`}
              >
                Review the wording before it becomes active · {draftContent.length}/500 characters
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <Button className="min-h-11 w-full sm:w-auto" disabled={pending} type="submit">
                {pending ? "Accepting…" : "Accept edited fact"}
              </Button>
              <Button
                className="min-h-11 w-full sm:w-auto"
                disabled={pending}
                onClick={() => {
                  setDraftContent(fact.content);
                  setDraftCategory(fact.category as SelfContextCategory);
                  setDraftSensitivity(fact.sensitivity);
                  setValidationError(null);
                  setIsEditing(false);
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="break-words whitespace-pre-wrap text-[length:var(--text-body)] leading-[var(--text-body-line)]">
              {fact.content}
            </p>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-surface/70 px-3 py-2.5">
              <p className="font-medium text-[length:var(--text-small)]">Supporting evidence</p>
              <p className="break-words text-[length:var(--text-small)] text-muted-foreground">
                {evidence}
              </p>
            </div>
            <p className="break-words text-[length:var(--text-small)] text-muted-foreground">
              {contextFactSensitivityLabel(fact.sensitivity)} · {contextFactProvenanceLabel(fact)}
            </p>
            {match ? (
              <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/70 bg-surface/70 px-3 py-2.5">
                <p className="break-words text-[length:var(--text-small)]">
                  {match.kind === "duplicate"
                    ? "This matches an active fact."
                    : "This conflicts with an active fact."}
                </p>
                <p className="break-words text-[length:var(--text-small)] text-muted-foreground">
                  Existing fact: {match.fact.content}
                </p>
                <Link
                  className="min-h-11 w-fit content-center text-[length:var(--text-small)] font-medium underline-offset-4 hover:underline"
                  href={`/account/about-you#context-fact-${match.fact.id}`}
                >
                  Edit existing fact
                </Link>
              </div>
            ) : null}
          </>
        )}

        {focusedMatchId && !match ? (
          <Link
            className="min-h-11 w-fit content-center text-[length:var(--text-small)] font-medium underline-offset-4 hover:underline"
            href={`/account/about-you#context-fact-${focusedMatchId}`}
          >
            Edit existing fact
          </Link>
        ) : null}

        {!isEditing ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <SuggestionReviewControls
              acceptLabel={pending ? "Accepting…" : "Accept"}
              dismissButtonRef={dismissButtonRef}
              dismissLabel="Dismiss suggested fact"
              onAccept={runAccept}
              onDismiss={runDismiss}
              onEdit={() => {
                setValidationError(null);
                setIsEditing(true);
              }}
              pending={pending}
            />
          </div>
        ) : null}

        <MutationFeedback
          error={
            validationError ?? dismissMutation.state.error ?? acceptMutation.state.error ?? null
          }
          pendingLabel={pending ? (activeMutation?.state.labels.pending ?? null) : null}
        />
      </article>
    </div>
  );
}
