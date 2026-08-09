"use client";

import type { ContextFactView } from "@tendnote/domain/context-facts";
import {
  type HouseholdContextActorIdentity,
  type HouseholdContextCategory,
  type HouseholdContextReconcileChoice,
  type HouseholdContextReconciliation,
  householdContextAudienceWarning,
} from "@tendnote/domain/household-context";
import type { Sensitivity } from "@tendnote/domain/privacy";
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";
import { HouseholdContextReconcilePanel } from "@/components/account/household-context-reconcile";
import type {
  CreateHouseholdContextAction,
  UpdateHouseholdContextAction,
} from "@/components/account/household-context-surface";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type HouseholdContextDraftView,
  householdContextCategories,
  householdContextSensitivityHint,
  householdContextSensitivityOptions,
} from "@/lib/household-context-view";

export type HouseholdContextEditorState =
  | { mode: "create" }
  | { mode: "edit"; fact: ContextFactView };

const DEFAULT_DRAFT: HouseholdContextDraftView = {
  category: "location",
  content: "",
  sensitivity: "normal",
};

/**
 * Writing or correcting one shared fact.
 *
 * Two things separate this from the private editor. The audience warning appears
 * the moment sensitivity escalates and carries a real acknowledgement, so
 * exposing something sensitive to the household is a decision rather than a
 * default. And a save that loses a race does not clear the form: the draft stays
 * exactly where it was and the reconcile panel opens above it.
 */
// fallow-ignore-next-line complexity -- One shared fact's editor holds draft, audience acknowledgement, version fence, and reconciliation together; splitting them would put the draft's survival in two places.
export function HouseholdContextEditor({
  createAction,
  editor,
  identities,
  now,
  onCancel,
  onFocusExisting,
  onKeepCurrent,
  onSaved,
  updateAction,
  viewerUserId,
}: {
  createAction: CreateHouseholdContextAction;
  editor: HouseholdContextEditorState;
  identities: readonly HouseholdContextActorIdentity[];
  now: Date;
  onCancel: () => void;
  onFocusExisting: (contextFactId: string) => void;
  onKeepCurrent: (message: string) => void;
  onSaved: (view: ContextFactView, message: string) => void;
  updateAction: UpdateHouseholdContextAction;
  viewerUserId: string;
}) {
  const editorId = useId();
  const contentId = `${editorId}-content`;
  const categoryId = `${editorId}-category`;
  const sensitivityId = `${editorId}-sensitivity`;
  const sensitivityHintId = `${editorId}-sensitivity-hint`;
  const helperId = `${editorId}-helper`;
  const errorId = `${editorId}-error`;
  const acknowledgeId = `${editorId}-acknowledge`;

  const [draft, setDraft] = useState<HouseholdContextDraftView>(() =>
    editor.mode === "edit"
      ? {
          category: editor.fact.category as HouseholdContextCategory,
          content: editor.fact.content,
          sensitivity: editor.fact.sensitivity,
        }
      : DEFAULT_DRAFT,
  );
  /**
   * The version this draft is fenced against. It starts as the one the reader
   * opened and advances only when they have actually read a newer statement, so
   * "Replace with mine" is a resubmission against what they were just shown
   * rather than a force flag the server would have to trust.
   */
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<Date | null>(
    editor.mode === "edit" ? editor.fact.updatedAt : null,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictFactId, setConflictFactId] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<HouseholdContextReconciliation | null>(null);
  const [pending, startTransition] = useTransition();
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const audienceWarning = householdContextAudienceWarning(draft.sensitivity);
  const needsAcknowledgement = audienceWarning !== null && !acknowledged;

  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  function focusContent() {
    const focus = () => contentRef.current?.focus();
    focus();
    window.requestAnimationFrame(focus);
  }

  function setSensitivity(sensitivity: Sensitivity) {
    // Escalating again after acknowledging is a new decision, not a kept one.
    setAcknowledged(false);
    setDraft((current) => ({ ...current, sensitivity }));
  }

  function save(fenceOverride?: Date) {
    const content = draft.content.trim();
    if (!content) {
      setError("Write one short thing everyone should know.");
      focusContent();
      return;
    }
    const fence = fenceOverride ?? expectedUpdatedAt;
    setError(null);
    setConflictFactId(null);
    startTransition(async () => {
      try {
        const result =
          editor.mode === "edit" && fence
            ? await updateAction({
                contextFactId: editor.fact.id,
                expectedUpdatedAt: fence.toISOString(),
                category: draft.category,
                content,
                sensitivity: draft.sensitivity,
              })
            : await createAction({
                category: draft.category,
                content,
                sensitivity: draft.sensitivity,
              });
        if (!result.ok) {
          setError(result.error);
          // A duplicate or contradiction names the fact the household already
          // has. Offering the way to it is the difference between "no" and a
          // second current answer to the same question.
          setConflictFactId(result.focusContextFactId ?? null);
          focusContent();
          return;
        }
        if (result.view.outcome === "stale") {
          // The draft is untouched on purpose. Nothing here clears it.
          setReconciliation(result.view.reconciliation);
          return;
        }
        setReconciliation(null);
        onSaved(
          result.view.fact,
          editor.mode === "edit"
            ? "Everyone here sees the correction."
            : "Added for everyone here.",
        );
      } catch {
        setError("That didn't go through. Your wording is still here — try again.");
        focusContent();
      }
    });
  }

  function chooseReconciliation(choice: HouseholdContextReconcileChoice) {
    if (!reconciliation) return;
    const current = reconciliation.current;
    if (choice === "keep_current") {
      onKeepCurrent("Kept the current wording.");
      return;
    }
    if (choice === "revise") {
      // Adopt the version just read, so the next save is fenced against what
      // the reader has actually seen rather than against a stale render.
      setExpectedUpdatedAt(current.updatedAt);
      setReconciliation(null);
      focusContent();
      return;
    }
    setExpectedUpdatedAt(current.updatedAt);
    setReconciliation(null);
    save(current.updatedAt);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || needsAcknowledgement) return;
    save();
  }

  const describedBy = error ? `${helperId} ${errorId}` : helperId;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {reconciliation ? (
        <HouseholdContextReconcilePanel
          identities={identities}
          now={now}
          onChoose={chooseReconciliation}
          pending={pending}
          reconciliation={reconciliation}
          viewerUserId={viewerUserId}
        />
      ) : null}

      <section
        aria-labelledby={`${editorId}-heading`}
        className="flex min-w-0 flex-col gap-3 rounded-xl border bg-surface px-4 py-4"
        data-household-context-editor
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
            id={`${editorId}-heading`}
          >
            {editor.mode === "edit" ? "Correct this fact" : "Add a fact"}
          </h2>
          <p className="max-w-[65ch] break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
            One current statement, in words you&rsquo;d say to everyone here. Plans, questions, and
            anything time-bound belong in their own places, not in shared context.
          </p>
        </div>

        <form
          aria-busy={pending || undefined}
          className="flex min-w-0 flex-col gap-4"
          onSubmit={submit}
        >
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={categoryId}>Category</Label>
              <Select
                disabled={pending}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    category: value as HouseholdContextCategory,
                  }))
                }
                value={draft.category}
              >
                <SelectTrigger className="min-h-11 w-full" id={categoryId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {householdContextCategories.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={sensitivityId}>Sensitivity</Label>
              <Select
                disabled={pending}
                onValueChange={(value) => setSensitivity(value as Sensitivity)}
                value={draft.sensitivity}
              >
                <SelectTrigger
                  aria-describedby={sensitivityHintId}
                  className="min-h-11 w-full"
                  id={sensitivityId}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {householdContextSensitivityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground"
                id={sensitivityHintId}
              >
                {householdContextSensitivityHint(draft.sensitivity)}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={contentId}>Fact</Label>
            <Textarea
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              className="min-h-28 min-w-0 resize-y"
              disabled={pending}
              id={contentId}
              maxLength={500}
              onChange={(event) =>
                setDraft((current) => ({ ...current, content: event.target.value }))
              }
              placeholder="For example: we're in the Lents neighbourhood."
              ref={contentRef}
              required
              value={draft.content}
            />
            <p
              className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
              id={helperId}
            >
              Everyone here can read it · {draft.content.length}/500 characters
            </p>
            {error ? (
              <p
                className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-destructive"
                id={errorId}
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {conflictFactId ? (
              <Button
                className="min-h-11 w-full sm:w-auto"
                onClick={() => onFocusExisting(conflictFactId)}
                type="button"
                variant="outline"
              >
                Open the fact that&rsquo;s already here
              </Button>
            ) : null}
          </div>

          {/*
            The audience disclosure is a step, not a footnote: it appears the
            moment sensitivity escalates and holds Save until it is answered.
            Inline rather than a dialog, so the wording being disclosed is still
            on screen while the reader decides (DESIGN.md §11).
          */}
          {audienceWarning ? (
            <div
              className="flex min-w-0 items-start gap-3 rounded-lg border bg-panel px-3.5 py-3"
              data-household-context-audience-warning
            >
              <Checkbox
                aria-describedby={`${acknowledgeId}-text`}
                checked={acknowledged}
                className="mt-0.5"
                disabled={pending}
                id={acknowledgeId}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
              />
              <Label className="flex min-w-0 flex-col items-start gap-1" htmlFor={acknowledgeId}>
                <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium">
                  I know everyone here will see this
                </span>
                <span
                  className="max-w-[65ch] break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] font-normal text-pretty text-muted-foreground"
                  id={`${acknowledgeId}-text`}
                >
                  {audienceWarning}
                </span>
              </Label>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              className="min-h-11 w-full sm:w-auto"
              disabled={pending || needsAcknowledgement}
              type="submit"
            >
              {pending ? "Saving…" : editor.mode === "edit" ? "Save correction" : "Save fact"}
            </Button>
            <Button
              className="min-h-11 w-full sm:w-auto"
              disabled={pending}
              onClick={onCancel}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
