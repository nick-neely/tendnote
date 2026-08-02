"use client";

import type { ContextFactView, Sensitivity } from "@tendnote/domain";
import type { FormEvent } from "react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type {
  SelfContextFactActionInput,
  UpdateSelfContextFactActionInput,
} from "@/app/actions/context-facts";
import {
  createSelfContextFactAction,
  updateSelfContextFactAction,
} from "@/app/actions/context-facts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  contextFactCategoryLabel,
  contextFactProvenanceLabel,
  contextFactSensitivityLabel,
  formatContextFactDate,
  isActiveSelfContextFact,
  type SelfContextCategory,
  type SelfContextFactDraft,
  type SelfContextFactMutationResult,
  selfContextCategories,
} from "@/lib/context-fact-view";

type CreateAction = (input: SelfContextFactActionInput) => Promise<SelfContextFactMutationResult>;
type UpdateAction = (
  input: UpdateSelfContextFactActionInput,
) => Promise<SelfContextFactMutationResult>;

type AboutYouSurfaceProps = {
  initialFacts: ContextFactView[];
  createAction?: CreateAction;
  updateAction?: UpdateAction;
};

type EditorState = { mode: "create" } | { mode: "edit"; fact: ContextFactView };

const DEFAULT_DRAFT: SelfContextFactDraft = {
  category: "background",
  content: "",
  sensitivity: "normal",
};

export function AboutYouSurface({
  initialFacts,
  createAction = createSelfContextFactAction,
  updateAction = updateSelfContextFactAction,
}: AboutYouSurfaceProps) {
  const [facts, setFacts] = useState(() => initialFacts.filter(isActiveSelfContextFact));
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLButtonElement | null>(null);

  function restoreFocus() {
    const target = restoreFocusRef.current;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) {
        target.focus();
      } else {
        addButtonRef.current?.focus();
      }
    });
  }

  function openCreate(trigger: HTMLButtonElement) {
    restoreFocusRef.current = trigger;
    setAnnouncement("");
    setEditor({ mode: "create" });
  }

  function openEdit(fact: ContextFactView, trigger: HTMLButtonElement) {
    restoreFocusRef.current = trigger;
    setAnnouncement("");
    setEditor({ mode: "edit", fact });
  }

  function closeEditor() {
    setEditor(null);
    restoreFocus();
  }

  function handleSaved(view: ContextFactView) {
    const mode = editor?.mode;
    setFacts((current) =>
      mode === "edit"
        ? current.map((fact) => (fact.id === view.id ? view : fact))
        : [view, ...current],
    );
    setAnnouncement(mode === "edit" ? "About you was updated." : "Fact added to About you.");
    setEditor(null);
    restoreFocus();
  }

  return (
    <section
      aria-labelledby="about-you-heading"
      className="mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-6"
      data-about-you
    >
      <header className="flex min-w-0 flex-col gap-1">
        <h1
          className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal"
          id="about-you-heading"
        >
          About you
        </h1>
        <p className="max-w-[65ch] break-words text-[length:var(--text-body)] leading-[var(--text-body-line)] text-muted-foreground">
          Keep a few small facts that help Eve understand you. You can change them whenever life
          changes.
        </p>
      </header>

      <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-surface px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium">
            Private Self Context
          </span>
          <span className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            These facts are private to you. This screen does not offer sharing controls.
          </span>
        </div>
        <Button
          className="min-h-11 w-full sm:w-auto"
          disabled={editor !== null}
          onClick={(event) => openCreate(event.currentTarget)}
          ref={addButtonRef}
          type="button"
        >
          Add a fact
        </Button>
      </div>

      {announcement ? (
        <p
          aria-live="polite"
          className="text-[length:var(--text-small)] text-muted-foreground"
          role="status"
        >
          {announcement}
        </p>
      ) : null}

      {editor ? (
        <ContextFactEditor
          createAction={createAction}
          editor={editor}
          key={editor.mode === "edit" ? editor.fact.id : "create"}
          onCancel={closeEditor}
          onSaved={handleSaved}
          updateAction={updateAction}
        />
      ) : null}

      {facts.length === 0 ? (
        <EmptyState
          description="Add one concise fact about your work, interests, location, preferences, or constraints."
          title="Nothing about you yet."
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-6">
          {selfContextCategories.map((category) => {
            const categoryFacts = facts.filter((fact) => fact.category === category.value);
            if (categoryFacts.length === 0) return null;
            return (
              <section
                aria-labelledby={`about-you-category-${category.value}`}
                className="flex min-w-0 flex-col gap-2"
                data-context-fact-category={category.value}
                key={category.value}
              >
                <h2
                  className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
                  id={`about-you-category-${category.value}`}
                >
                  {category.label}
                </h2>
                <div className="min-w-0 divide-y rounded-lg border bg-surface">
                  {categoryFacts.map((fact) => (
                    <ContextFactRow fact={fact} key={fact.id} onEdit={openEdit} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ContextFactRow({
  fact,
  onEdit,
}: {
  fact: ContextFactView;
  onEdit: (fact: ContextFactView, trigger: HTMLButtonElement) => void;
}) {
  return (
    <article className="flex min-w-0 items-start justify-between gap-3 px-3.5 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="min-w-0 break-words whitespace-pre-wrap text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {fact.content}
        </p>
        <p className="min-w-0 break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          {contextFactSensitivityLabel(fact.sensitivity)} · {contextFactProvenanceLabel(fact)} ·{" "}
          Updated {formatContextFactDate(fact.updatedAt)}
        </p>
      </div>
      <Button
        aria-label={`Edit ${contextFactCategoryLabel(fact.category as SelfContextCategory)} fact`}
        className="min-h-11 min-w-11 shrink-0"
        data-context-fact-edit={fact.id}
        onClick={(event) => onEdit(fact, event.currentTarget)}
        size="sm"
        type="button"
        variant="outline"
      >
        Edit
      </Button>
    </article>
  );
}

function ContextFactEditor({
  createAction,
  editor,
  onCancel,
  onSaved,
  updateAction,
}: {
  createAction: CreateAction;
  editor: EditorState;
  onCancel: () => void;
  onSaved: (view: ContextFactView) => void;
  updateAction: UpdateAction;
}) {
  const editorId = useId();
  const contentId = `${editorId}-content`;
  const categoryId = `${editorId}-category`;
  const sensitivityId = `${editorId}-sensitivity`;
  const helperId = `${editorId}-helper`;
  const errorId = `${editorId}-error`;
  const [draft, setDraft] = useState<SelfContextFactDraft>(() =>
    editor.mode === "edit"
      ? {
          category: editor.fact.category as SelfContextCategory,
          content: editor.fact.content,
          sensitivity: editor.fact.sensitivity,
        }
      : DEFAULT_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const content = contentRef.current ?? document.getElementById(contentId);
    content?.focus();
  }, [contentId]);

  useEffect(() => {
    if (!error || pending) return;
    const content = contentRef.current ?? document.getElementById(contentId);
    content?.focus();
  }, [contentId, error, pending]);

  function focusContent() {
    const focus = () => {
      const content = contentRef.current ?? document.getElementById(contentId);
      content?.focus();
    };
    focus();
    window.requestAnimationFrame(focus);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.content.trim();
    if (!content) {
      setError("Add a concise fact.");
      focusContent();
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result =
          editor.mode === "edit"
            ? await updateAction({
                contextFactId: editor.fact.id,
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
          focusContent();
          return;
        }
        onSaved(result.view);
      } catch {
        setError("We couldn't save this fact. Your draft is still here. Try again.");
        focusContent();
      }
    });
  }

  const heading = editor.mode === "edit" ? "Edit fact" : "Add a fact";
  const describedBy = error ? `${helperId} ${errorId}` : helperId;

  return (
    <section
      aria-labelledby={`${editorId}-heading`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-surface px-4 py-4"
      data-context-fact-editor
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
          id={`${editorId}-heading`}
        >
          {heading}
        </h2>
        <p className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Use one concise statement. Self Context is always private here.
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
            <select
              className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              disabled={pending}
              id={categoryId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  category: event.target.value as SelfContextCategory,
                }))
              }
              value={draft.category}
            >
              {selfContextCategories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={sensitivityId}>Sensitivity</Label>
            <select
              className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              disabled={pending}
              id={sensitivityId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  sensitivity: event.target.value as Sensitivity,
                }))
              }
              value={draft.sensitivity}
            >
              <option value="normal">Normal — may help with relevant orientation</option>
              <option value="sensitive">Sensitive — use carefully when relevant</option>
              <option value="restricted">Restricted — only for a direct relevant request</option>
            </select>
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
            placeholder="For example: I run a software consultancy."
            ref={contentRef}
            required
            value={draft.content}
          />
          <p
            className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
            id={helperId}
          >
            Private to you · {draft.content.length}/500 characters
          </p>
          {error ? (
            <p
              className="break-words text-[length:var(--text-small)] text-destructive"
              id={errorId}
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Button className="min-h-11 w-full sm:w-auto" disabled={pending} type="submit">
            {pending
              ? "Saving…"
              : error
                ? "Try again"
                : editor.mode === "edit"
                  ? "Save changes"
                  : "Save fact"}
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
          {pending ? (
            <span
              aria-live="polite"
              className="text-[length:var(--text-small)] text-muted-foreground"
              role="status"
            >
              Saving your fact…
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
