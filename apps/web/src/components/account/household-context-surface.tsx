"use client";

import type { ContextFactView } from "@tendnote/domain/context-facts";
import { contextFactCategoryLabel } from "@tendnote/domain/context-facts";
import {
  buildHouseholdContextBoard,
  HOUSEHOLD_CONTEXT_ARCHIVE_NOTICE,
  HOUSEHOLD_CONTEXT_EMPTY_DESCRIPTION,
  HOUSEHOLD_CONTEXT_EMPTY_TITLE,
  HOUSEHOLD_CONTEXT_NO_DELETE_NOTICE,
  type HouseholdContextActorIdentity,
  householdContextAttributionLine,
} from "@tendnote/domain/household-context";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  type CreateHouseholdContextFactActionInput,
  archiveHouseholdContextFactAction as defaultArchiveAction,
  createHouseholdContextFactAction as defaultCreateAction,
  restoreHouseholdContextFactAction as defaultRestoreAction,
  updateHouseholdContextFactAction as defaultUpdateAction,
  type HouseholdContextLifecycleActionInput,
  type UpdateHouseholdContextFactActionInput,
} from "@/app/actions/household-context";
import {
  HouseholdContextEditor,
  type HouseholdContextEditorState,
} from "@/components/account/household-context-editor";
import { ChevronDownIcon } from "@/components/icons";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import {
  type HouseholdContextMutationResult,
  householdContextSensitivityLabel,
  isHouseholdContextFact,
} from "@/lib/household-context-view";
import { useDeepLinkReveal } from "@/lib/use-deep-link-highlight";
import { cn } from "@/lib/utils";

const GENERIC_ERROR = "That didn't go through. Nothing changed, so you can try again.";
const STALE_LIFECYCLE_NOTICE =
  "Someone here changed this while the page was open. Nothing of yours was lost — have another look.";

export type CreateHouseholdContextAction = (
  input: CreateHouseholdContextFactActionInput,
) => Promise<HouseholdContextMutationResult>;
export type UpdateHouseholdContextAction = (
  input: UpdateHouseholdContextFactActionInput,
) => Promise<HouseholdContextMutationResult>;
export type HouseholdContextLifecycleAction = (
  input: HouseholdContextLifecycleActionInput,
) => Promise<HouseholdContextMutationResult>;

export type HouseholdContextActions = {
  createAction?: CreateHouseholdContextAction;
  updateAction?: UpdateHouseholdContextAction;
  archiveAction?: HouseholdContextLifecycleAction;
  restoreAction?: HouseholdContextLifecycleAction;
};

type EditorState = HouseholdContextEditorState;

/**
 * The focused page for what a household holds in common.
 *
 * It is deliberately the same shape as **About you** — one strip stating the
 * audience, one way in, flat category rows, archived behind disclosure — because
 * a member who has managed their private facts should not have to learn a second
 * model to manage the shared ones. The single difference is the one that matters,
 * and it is the first thing on the page: everything here is readable by everyone
 * here.
 *
 * Three things are absent on purpose. There is no delete: no one member may
 * permanently remove a fact the household owns. There is no activity feed: the
 * quiet attribution on each row is the whole history this page tells. And there
 * is no count of what is missing, no progress, no setup state — a household with
 * two facts is not behind a household with eight.
 */
export function HouseholdContextSurface({
  viewerUserId,
  initialFacts,
  identities,
  renderedAt,
  createAction = defaultCreateAction,
  updateAction = defaultUpdateAction,
  archiveAction = defaultArchiveAction,
  restoreAction = defaultRestoreAction,
}: {
  viewerUserId: string;
  initialFacts: readonly ContextFactView[];
  identities: readonly HouseholdContextActorIdentity[];
  /**
   * The instant the server rendered, which every relative time is measured
   * from.
   *
   * Taken as a prop rather than read from the clock so the server and the
   * hydrated tree agree, and advanced only when a write lands — that is exactly
   * as fresh as a page with no ambient notification is supposed to be, and the
   * page says so: the way to see where things stand is to reload.
   */
  renderedAt: Date;
} & HouseholdContextActions) {
  const router = useRouter();
  const [facts, setFacts] = useState(() => initialFacts.filter(isHouseholdContextFact));
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(renderedAt);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLButtonElement | null>(null);

  const board = buildHouseholdContextBoard({ facts });

  function restoreFocus() {
    const target = restoreFocusRef.current;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
      else addButtonRef.current?.focus();
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

  function applyFact(view: ContextFactView) {
    setNow(new Date());
    setFacts((current) => {
      const index = current.findIndex((fact) => fact.id === view.id);
      if (index === -1) return [view, ...current];
      const next = [...current];
      next[index] = view;
      return next;
    });
  }

  /**
   * A write landed. The authoritative record replaces the local one immediately
   * so every member's next read is the same, and the server tree catches up
   * underneath rather than being what the reader waits for.
   */
  function handleSaved(view: ContextFactView, message: string) {
    applyFact(view);
    setAnnouncement(message);
    setEditor(null);
    restoreFocus();
    router.refresh();
  }

  /**
   * A duplicate or contradiction sends the reader to the fact the household
   * already has, rather than leaving them with a refusal and no next step. This
   * is the "focus the existing fact" rule: one current answer per question.
   */
  function focusExistingFact(contextFactId: string) {
    setEditor(null);
    setAnnouncement("There's already a fact for this. Correct that one instead.");
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-household-context-edit="${contextFactId}"]`)
        ?.focus();
    });
  }

  /**
   * An archive or restore was refused because the page was out of date.
   *
   * There is no draft to protect here, so this does not reconcile — it says what
   * happened and reloads the authoritative state underneath. Guessing at the new
   * state locally would be inventing the very thing that just went stale.
   */
  function handleStaleLifecycle() {
    setAnnouncement(STALE_LIFECYCLE_NOTICE);
    router.refresh();
  }

  useDeepLinkReveal((elementId) => {
    const archivedElementIds = new Set(
      board.archived.map((fact) => `household-context-fact-${fact.id}`),
    );
    if (!archivedElementIds.has(elementId)) return false;
    setShowArchived(true);
    return true;
  });

  const hasAnything = board.activeCount > 0 || board.archived.length > 0;

  return (
    <section
      aria-labelledby="household-context-heading"
      className="flex min-w-0 w-full flex-col gap-6"
      data-household-context
    >
      <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-surface px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium"
            id="household-context-heading"
          >
            Shared with everyone here
          </span>
          <span className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            Anyone in the household can add, correct, or archive these. Sensitivity changes how
            readily Eve raises a fact, not who can read it.
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
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground"
          role="status"
        >
          {announcement}
        </p>
      ) : null}

      {editor ? (
        <HouseholdContextEditor
          createAction={createAction}
          editor={editor}
          identities={identities}
          key={editor.mode === "edit" ? editor.fact.id : "create"}
          now={now}
          onCancel={() => {
            setEditor(null);
            restoreFocus();
          }}
          onFocusExisting={focusExistingFact}
          onKeepCurrent={(message) => {
            setAnnouncement(message);
            setEditor(null);
            restoreFocus();
            router.refresh();
          }}
          onSaved={handleSaved}
          updateAction={updateAction}
          viewerUserId={viewerUserId}
        />
      ) : null}

      {hasAnything ? null : (
        <EmptyState
          description={HOUSEHOLD_CONTEXT_EMPTY_DESCRIPTION}
          title={HOUSEHOLD_CONTEXT_EMPTY_TITLE}
        />
      )}

      {board.groups.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-6">
          {board.groups.map((group) => (
            <section
              aria-labelledby={`household-context-category-${group.category}`}
              className="flex min-w-0 flex-col gap-2"
              data-household-context-category={group.category}
              key={group.category}
            >
              <h2
                className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
                id={`household-context-category-${group.category}`}
              >
                {group.label}
              </h2>
              <div className="min-w-0 divide-y rounded-lg border bg-surface">
                {group.facts.map((fact) => (
                  <HouseholdContextRow
                    archiveAction={archiveAction}
                    fact={fact}
                    identities={identities}
                    key={fact.id}
                    now={now}
                    onEdit={openEdit}
                    onRevealArchived={() => setShowArchived(true)}
                    onSaved={handleSaved}
                    onStale={handleStaleLifecycle}
                    restoreAction={restoreAction}
                    viewerUserId={viewerUserId}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : board.archived.length > 0 ? (
        <p className="rounded-lg border border-dashed px-3.5 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Nothing current right now. Archived facts stay out of Eve&rsquo;s orientation until
          someone here restores one.
        </p>
      ) : null}

      {board.archived.length > 0 ? (
        <section aria-labelledby="household-context-archived-heading">
          <Collapsible
            className="flex min-w-0 flex-col gap-2"
            onOpenChange={setShowArchived}
            open={showArchived}
          >
            <CollapsibleTrigger asChild>
              <Button
                className="min-h-11 w-full justify-between px-3.5 sm:w-auto"
                type="button"
                variant="outline"
              >
                <span id="household-context-archived-heading">
                  {showArchived
                    ? "Hide archived facts"
                    : `Show archived facts (${board.archived.length})`}
                </span>
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    "shrink-0 text-muted-foreground transition-transform duration-150 ease-(--motion-ease-out) motion-reduce:transition-none",
                    showArchived && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="min-w-0">
              <div className="min-w-0 divide-y rounded-lg border border-dashed bg-surface">
                {board.archived.map((fact) => (
                  <HouseholdContextRow
                    archiveAction={archiveAction}
                    fact={fact}
                    identities={identities}
                    key={fact.id}
                    now={now}
                    onEdit={openEdit}
                    onRevealArchived={() => setShowArchived(true)}
                    onSaved={handleSaved}
                    onStale={handleStaleLifecycle}
                    restoreAction={restoreAction}
                    viewerUserId={viewerUserId}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>
      ) : null}

      {hasAnything ? (
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          {HOUSEHOLD_CONTEXT_NO_DELETE_NOTICE}
        </p>
      ) : null}
    </section>
  );
}

/**
 * One shared fact, read as a line of the household's own ledger.
 *
 * Content leads; sensitivity, category, and who last touched it follow in one
 * quiet metadata line. Sensitivity is a text badge rather than a colour, because
 * "restricted" is a fact about the record, not an alarm — and colour alone would
 * carry it to nobody using a screen reader (DESIGN.md §6, §8).
 */
function HouseholdContextRow({
  archiveAction,
  fact,
  identities,
  now,
  onEdit,
  onRevealArchived,
  onSaved,
  onStale,
  restoreAction,
  viewerUserId,
}: {
  archiveAction: HouseholdContextLifecycleAction;
  fact: ContextFactView;
  identities: readonly HouseholdContextActorIdentity[];
  now: Date;
  onEdit: (fact: ContextFactView, trigger: HTMLButtonElement) => void;
  onRevealArchived: () => void;
  onSaved: (view: ContextFactView, message: string) => void;
  onStale: () => void;
  restoreAction: HouseholdContextLifecycleAction;
  viewerUserId: string;
}) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const archived = fact.lifecycle === "archived";
  const attribution = householdContextAttributionLine({ fact, viewerUserId, identities, now });

  function run(
    action: HouseholdContextLifecycleAction,
    messages: { saved: string; failed: string },
    onDone?: () => void,
  ) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await action({
          contextFactId: fact.id,
          expectedUpdatedAt: fact.updatedAt.toISOString(),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.view.outcome === "stale") {
          onStale();
          onDone?.();
          return;
        }
        onSaved(result.view.fact, messages.saved);
        onDone?.();
      } catch {
        setError(messages.failed);
      }
    });
  }

  return (
    <article
      className="flex min-w-0 flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-start sm:justify-between"
      id={`household-context-fact-${fact.id}`}
      tabIndex={-1}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="min-w-0 break-words whitespace-pre-wrap text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {fact.content}
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          {fact.sensitivity === "normal" ? null : (
            <Badge variant="outline">{householdContextSensitivityLabel(fact.sensitivity)}</Badge>
          )}
          {/*
            Category is the section heading for a current fact, so repeating it
            on the row would be noise. The archive has no headings — one dashed
            list across every category — so there it is the row's own job.
          */}
          {archived ? <span>{contextFactCategoryLabel(fact.category)} ·</span> : null}
          <span>{attribution ?? contextFactCategoryLabel(fact.category)}</span>
        </p>
        {error ? (
          <p
            className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
        {archived ? (
          <Button
            className="min-h-11 min-w-11"
            data-household-context-restore={fact.id}
            disabled={pending}
            onClick={() =>
              run(restoreAction, {
                saved: "Restored to what everyone sees.",
                failed: GENERIC_ERROR,
              })
            }
            type="button"
            variant="outline"
          >
            {pending ? "Restoring…" : "Restore"}
          </Button>
        ) : (
          <>
            <Button
              aria-label={`Edit the ${contextFactCategoryLabel(fact.category)} fact`}
              className="min-h-11 min-w-11"
              data-household-context-edit={fact.id}
              disabled={pending}
              onClick={(event) => onEdit(fact, event.currentTarget)}
              type="button"
              variant="outline"
            >
              Edit
            </Button>
            {/*
              Archiving is the one press here that changes what the whole
              household sees, so it is the one that pauses. Not destructive
              treatment, though — nothing is lost and anyone can put it back.
            */}
            <AlertDialog
              onOpenChange={(next) => {
                if (pending) return;
                setArchiveOpen(next);
                if (next) setError(null);
              }}
              open={archiveOpen}
            >
              <AlertDialogTrigger asChild>
                <Button
                  className="min-h-11"
                  data-household-context-archive={fact.id}
                  disabled={pending}
                  type="button"
                  variant="outline"
                >
                  Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Take this out of what everyone sees?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {HOUSEHOLD_CONTEXT_ARCHIVE_NOTICE}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={pending}
                    onClick={(event) => {
                      event.preventDefault();
                      onRevealArchived();
                      run(
                        archiveAction,
                        { saved: "Archived. Anyone here can restore it.", failed: GENERIC_ERROR },
                        () => setArchiveOpen(false),
                      );
                    }}
                  >
                    {pending ? "Archiving…" : "Archive"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </article>
  );
}
