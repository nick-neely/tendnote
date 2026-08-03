"use client";

import type { ContextFactView, Sensitivity } from "@tendnote/domain";
import type { FormEvent } from "react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type {
  ArchiveSelfContextFactActionInput,
  DeleteSelfContextFactActionInput,
  RestoreSelfContextFactActionInput,
  SelfContextFactActionInput,
  UpdateSelfContextFactActionInput,
} from "@/app/actions/context-facts";
import {
  archiveSelfContextFactAction,
  createSelfContextFactAction,
  deleteSelfContextFactAction,
  restoreSelfContextFactAction,
  updateSelfContextFactAction,
} from "@/app/actions/context-facts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  isArchivedSelfContextFact,
  isSelfContextFact,
  type SelfContextCategory,
  type SelfContextFactDeleteResult,
  type SelfContextFactDraft,
  type SelfContextFactMutationResult,
  type SelfContextFactMutationView,
  selfContextCategories,
} from "@/lib/context-fact-view";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import { ReversibleMutationProvider, useReversibleMutation } from "@/lib/reversible-mutation";

type CreateAction = (input: SelfContextFactActionInput) => Promise<SelfContextFactMutationResult>;
type UpdateAction = (
  input: UpdateSelfContextFactActionInput,
) => Promise<SelfContextFactMutationResult>;
type ArchiveAction = (
  input: ArchiveSelfContextFactActionInput,
) => Promise<SelfContextFactMutationResult>;
type RestoreAction = (
  input: RestoreSelfContextFactActionInput,
) => Promise<SelfContextFactMutationResult>;
type DeleteAction = (
  input: DeleteSelfContextFactActionInput,
) => Promise<SelfContextFactDeleteResult>;

type AboutYouSurfaceProps = {
  initialFacts: ContextFactView[];
  createAction?: CreateAction;
  updateAction?: UpdateAction;
  archiveAction?: ArchiveAction;
  restoreAction?: RestoreAction;
  deleteAction?: DeleteAction;
};

type EditorState = { mode: "create" } | { mode: "edit"; fact: ContextFactView };

const DEFAULT_DRAFT: SelfContextFactDraft = {
  category: "background",
  content: "",
  sensitivity: "normal",
};

function factMutationView(
  result: SelfContextFactMutationResult,
): OwnerActionResult<ContextFactView> {
  return result.ok ? { ok: true, view: result.view.fact } : result;
}

export function AboutYouSurface(props: AboutYouSurfaceProps) {
  return (
    <ReversibleMutationProvider>
      <AboutYouSurfaceContent {...props} />
    </ReversibleMutationProvider>
  );
}

// fallow-ignore-next-line complexity -- About you coordinates one bounded owner surface: archived disclosure, editor focus, and lifecycle reconciliation share one authoritative list.
function AboutYouSurfaceContent({
  initialFacts,
  createAction = createSelfContextFactAction,
  updateAction = updateSelfContextFactAction,
  archiveAction = archiveSelfContextFactAction,
  restoreAction = restoreSelfContextFactAction,
  deleteAction = deleteSelfContextFactAction,
}: AboutYouSurfaceProps) {
  const [facts, setFacts] = useState(() => initialFacts.filter(isSelfContextFact));
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
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

  function applyFact(view: ContextFactView) {
    setFacts((current) => {
      const index = current.findIndex((fact) => fact.id === view.id);
      if (index === -1) return [view, ...current];
      const next = [...current];
      next[index] = view;
      return next;
    });
  }

  function removeFact(contextFactId: string) {
    setFacts((current) => current.filter((fact) => fact.id !== contextFactId));
    setAnnouncement("The fact was permanently deleted.");
  }

  function handleSaved(mutation: SelfContextFactMutationView) {
    applyFact(mutation.fact);
    setAnnouncement(
      mutation.decision === "existing"
        ? "That fact is already in About you."
        : mutation.decision === "updated"
          ? "About you was updated."
          : "Fact added to About you.",
    );
    setEditor(null);
    restoreFocus();
  }

  function focusExistingFact(contextFactId: string) {
    setEditor(null);
    setAnnouncement("Edit the existing fact to correct this statement.");
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-context-fact-edit="${contextFactId}"]`)
        ?.focus();
    });
  }

  const activeFacts = facts.filter(isActiveSelfContextFact);
  const archivedFacts = facts.filter(isArchivedSelfContextFact);

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
            These facts are private to you. Sensitivity controls how carefully they may be used;
            this screen does not offer sharing controls.
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
          onFocusExisting={focusExistingFact}
          onSaved={handleSaved}
          updateAction={updateAction}
        />
      ) : null}

      {activeFacts.length === 0 && archivedFacts.length === 0 ? (
        <EmptyState
          description="Add one concise fact about your work, interests, location, preferences, or constraints."
          title="Nothing about you yet."
        />
      ) : null}

      {activeFacts.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-6">
          {selfContextCategories.map((category) => {
            const categoryFacts = activeFacts.filter((fact) => fact.category === category.value);
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
                    <ContextFactRow
                      archiveAction={archiveAction}
                      deleteAction={deleteAction}
                      fact={fact}
                      key={fact.id}
                      onDeleted={removeFact}
                      onFactChanged={applyFact}
                      onEdit={openEdit}
                      onRevealArchived={() => setShowArchived(true)}
                      onRestoreFocus={() => addButtonRef.current?.focus()}
                      onStatus={setAnnouncement}
                      restoreAction={restoreAction}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : archivedFacts.length > 0 ? (
        <p className="rounded-lg border border-dashed px-3.5 py-3 text-[length:var(--text-small)] text-muted-foreground">
          No active facts. Archived facts stay out of Eve&rsquo;s normal orientation until you
          restore them.
        </p>
      ) : null}

      {archivedFacts.length > 0 ? (
        <section aria-labelledby="about-you-archived-heading" className="flex flex-col gap-2">
          <Button
            aria-expanded={showArchived}
            className="min-h-11 w-full justify-between px-3.5 sm:w-auto"
            onClick={() => setShowArchived((current) => !current)}
            type="button"
            variant="outline"
          >
            <span id="about-you-archived-heading">
              {showArchived
                ? "Hide archived facts"
                : `Show archived facts (${archivedFacts.length})`}
            </span>
            <span aria-hidden>{showArchived ? "↑" : "↓"}</span>
          </Button>
          {showArchived ? (
            <div className="min-w-0 divide-y rounded-lg border border-dashed bg-surface">
              {archivedFacts.map((fact) => (
                <ContextFactRow
                  archiveAction={archiveAction}
                  deleteAction={deleteAction}
                  fact={fact}
                  key={fact.id}
                  onDeleted={removeFact}
                  onFactChanged={applyFact}
                  onEdit={openEdit}
                  onRevealArchived={() => setShowArchived(true)}
                  onRestoreFocus={() => addButtonRef.current?.focus()}
                  onStatus={setAnnouncement}
                  restoreAction={restoreAction}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

// fallow-ignore-next-line complexity -- A fact row deliberately serializes edit, archive/Undo, restore, and permanent-delete intents around one owner-scoped record.
function ContextFactRow({
  archiveAction,
  deleteAction,
  fact,
  onDeleted,
  onFactChanged,
  onEdit,
  onRevealArchived,
  onRestoreFocus,
  onStatus,
  restoreAction,
}: {
  archiveAction: ArchiveAction;
  deleteAction: DeleteAction;
  fact: ContextFactView;
  onDeleted: (contextFactId: string) => void;
  onFactChanged: (view: ContextFactView) => void;
  onEdit: (fact: ContextFactView, trigger: HTMLButtonElement) => void;
  onRevealArchived: () => void;
  onRestoreFocus: () => void;
  onStatus: (message: string) => void;
  restoreAction: RestoreAction;
}) {
  const archiveMutation = useReversibleMutation(fact.id, "archive");
  const restoreMutation = useReversibleMutation(fact.id, "restore");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const archived = fact.lifecycle === "archived";
  const pending = archiveMutation.state.pending || restoreMutation.state.pending || deletePending;

  function runArchive() {
    onRevealArchived();
    archiveMutation.run({
      kind: "optimistic",
      prior: fact,
      adapter: {
        project: (prior) => ({
          ...prior,
          lifecycle: "archived" as const,
          archivedAt: new Date(),
          updatedAt: new Date(),
        }),
        inverse: async (_prior, authoritative) =>
          factMutationView(
            await restoreAction({
              contextFactId: authoritative.id,
              expectedArchivedAt: authoritative.archivedAt?.toISOString(),
            }),
          ),
      },
      apply: (view) => {
        onFactChanged(view);
        return true;
      },
      command: async () =>
        factMutationView(
          await archiveAction({
            contextFactId: fact.id,
            expectedUpdatedAt: fact.updatedAt.toISOString(),
          }),
        ),
      focusTarget: () =>
        document.querySelector<HTMLButtonElement>(
          `[data-context-fact-archive="${fact.id}"], [data-context-fact-restore="${fact.id}"]`,
        ),
      labels: {
        pending: "Archiving this fact…",
        rollback: "The fact was kept active after the archive failed.",
        success: "Fact archived. Undo available.",
        undo: "Undo archive",
        undone: "Fact restored.",
      },
    });
  }

  function runRestore(trigger: HTMLButtonElement) {
    restoreMutation.run({
      kind: "pending",
      command: async () =>
        factMutationView(
          await restoreAction({
            contextFactId: fact.id,
            expectedArchivedAt: fact.archivedAt?.toISOString(),
          }),
        ),
      apply: (view) => {
        onFactChanged(view);
        onStatus("Fact restored to active About you.");
        return true;
      },
      focusTarget: () =>
        document.querySelector<HTMLButtonElement>(
          `[data-context-fact-edit="${fact.id}"], [data-context-fact-archive="${fact.id}"], [data-context-fact-restore="${fact.id}"]`,
        ) ?? (trigger.isConnected ? trigger : null),
      labels: {
        pending: "Restoring this fact…",
        rollback: "The fact stayed archived.",
        success: "Fact restored to active About you.",
        undo: "",
        undone: "",
      },
    });
  }

  function remove() {
    if (deletePending) return;
    setDeleteError(null);
    startDelete(async () => {
      try {
        const result = await deleteAction({ contextFactId: fact.id });
        if (!result.ok) {
          setDeleteError(result.error);
          return;
        }
        setDeleteOpen(false);
        onDeleted(result.view.deletedContextFactId);
        window.requestAnimationFrame(() => {
          if (deleteTriggerRef.current?.isConnected) deleteTriggerRef.current.focus();
          else onRestoreFocus();
        });
      } catch {
        setDeleteError("We couldn't delete this fact. Try again.");
      }
    });
  }

  return (
    <article className="flex min-w-0 flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="min-w-0 break-words whitespace-pre-wrap text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {fact.content}
        </p>
        <p className="min-w-0 break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          {contextFactSensitivityLabel(fact.sensitivity)} · {contextFactProvenanceLabel(fact)} ·
          Last changed {formatContextFactDate(fact.updatedAt)}
        </p>
        {archiveMutation.state.error || restoreMutation.state.error ? (
          <p className="break-words text-[length:var(--text-small)] text-destructive" role="alert">
            {archiveMutation.state.error ?? restoreMutation.state.error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
        {archived ? (
          archiveMutation.state.undoAvailable ? (
            <Button
              className="min-h-11 min-w-11"
              data-context-fact-restore={fact.id}
              disabled={pending}
              onClick={archiveMutation.requestUndo}
              type="button"
              variant="outline"
            >
              {archiveMutation.state.undoRequested ? "Undoing…" : "Undo archive"}
            </Button>
          ) : (
            <Button
              className="min-h-11 min-w-11"
              data-context-fact-restore={fact.id}
              disabled={pending}
              onClick={(event) => runRestore(event.currentTarget)}
              type="button"
              variant="outline"
            >
              {restoreMutation.state.pending ? "Restoring…" : "Restore"}
            </Button>
          )
        ) : (
          <>
            <Button
              aria-label={`Edit ${contextFactCategoryLabel(fact.category as SelfContextCategory)} fact`}
              className="min-h-11 min-w-11"
              data-context-fact-edit={fact.id}
              disabled={pending}
              onClick={(event) => onEdit(fact, event.currentTarget)}
              type="button"
              variant="outline"
            >
              Edit
            </Button>
            <Button
              className="min-h-11"
              data-context-fact-archive={fact.id}
              disabled={pending}
              onClick={runArchive}
              type="button"
              variant="outline"
            >
              {archiveMutation.state.pending ? "Archiving…" : "Archive"}
            </Button>
          </>
        )}
        <AlertDialog
          onOpenChange={(next) => {
            if (pending) return;
            setDeleteOpen(next);
            if (next) setDeleteError(null);
          }}
          open={deleteOpen}
        >
          <AlertDialogTrigger asChild>
            <Button
              className="min-h-11 text-muted-foreground hover:text-destructive"
              disabled={pending}
              onClick={(event) => {
                deleteTriggerRef.current = event.currentTarget;
              }}
              ref={deleteTriggerRef}
              type="button"
              variant="ghost"
            >
              Delete permanently
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this fact permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the retained Self Context statement and any suggestion evidence tied to
                it. It cannot be undone. Archive is safer when you may want the fact later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError ? (
              <p className="text-[length:var(--text-small)] text-destructive" role="alert">
                {deleteError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deletePending}
                onClick={(event) => {
                  event.preventDefault();
                  remove();
                }}
                variant="destructive"
              >
                {deletePending ? "Deleting…" : "Delete permanently"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </article>
  );
}

// fallow-ignore-next-line complexity -- The editor keeps draft, validation, stale-intent, conflict focus, and authoritative save state together for one concise form.
function ContextFactEditor({
  createAction,
  editor,
  onCancel,
  onFocusExisting,
  onSaved,
  updateAction,
}: {
  createAction: CreateAction;
  editor: EditorState;
  onCancel: () => void;
  onFocusExisting: (contextFactId: string) => void;
  onSaved: (view: SelfContextFactMutationView) => void;
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
  const [conflictFactId, setConflictFactId] = useState<string | null>(null);
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
    setConflictFactId(null);
    startTransition(async () => {
      try {
        const result =
          editor.mode === "edit"
            ? await updateAction({
                contextFactId: editor.fact.id,
                expectedUpdatedAt: editor.fact.updatedAt.toISOString(),
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
          setConflictFactId(result.focusContextFactId ?? null);
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
          Use one concise statement. Self Context is private here; sensitivity is separate from
          visibility.
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
          {conflictFactId ? (
            <Button
              className="min-h-11 w-full sm:w-auto"
              onClick={() => onFocusExisting(conflictFactId)}
              type="button"
              variant="outline"
            >
              Edit existing fact
            </Button>
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
