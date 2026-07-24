"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  archiveGeneralActionAction,
  completeGeneralActionAction,
  getActionComposerOptionsAction,
  getActionSecondaryLedgerViewsAction,
  getSuggestedActionViewsAction,
  pauseGeneralActionAction,
  reopenGeneralActionAction,
  restoreGeneralActionAction,
  resumeGeneralActionAction,
} from "@/app/actions/general-actions";
import { AreaManagerDialog } from "@/components/general-action-area-manager";
import { CreateActionForm } from "@/components/general-action-create-form";
import { PausedRoutineRow } from "@/components/general-action-paused-row";
import type { ActionPersonOption } from "@/components/general-action-people-field";
import { ResolvedActionRow } from "@/components/general-action-resolved-row";
import { ActionRow } from "@/components/general-action-row";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { SlidersHorizontalIcon } from "@/components/icons";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { SuggestedGeneralActionReviewCard } from "@/components/suggested-general-action-review";
import { Button } from "@/components/ui/button";
import {
  filterActionsByArea,
  pickVisibleAreaChips,
  resolveActiveAreaId,
} from "@/lib/general-action-area-filter";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import type { GeneralActionMutationResult, GeneralActionView } from "@/lib/general-action-view";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import { useServerSyncedList } from "@/lib/use-server-synced-list";
import { cn } from "@/lib/utils";

const actionId = (action: GeneralActionView) => action.id;
const actionRevision = (action: GeneralActionView) => action.revision;
const areaId = (area: GeneralActionAreaView) => area.id;
const reviewActionId = (review: SuggestedGeneralActionReviewView) => review.action.id;

type SecondaryUndo = {
  error?: string;
  label: string;
  originalPending: boolean;
  requested: boolean;
  inverse: () => Promise<GeneralActionMutationResult>;
  applyInverse: (view: GeneralActionView) => void;
};

/** The moment an active action next wants attention; unscheduled sorts last. */
function surfacingKey(action: GeneralActionView): string | null {
  if (action.surfaceState === "deferred") {
    return action.deferUntilISO;
  }
  return action.dueAtISO;
}

function sortActive(actions: GeneralActionView[]): GeneralActionView[] {
  return [...actions].sort((a, b) => {
    const aKey = surfacingKey(a);
    const bKey = surfacingKey(b);
    if (aKey && bKey) {
      return aKey.localeCompare(bKey);
    }
    if (aKey) {
      return -1;
    }
    if (bKey) {
      return 1;
    }
    return 0;
  });
}

function mergeByRevision(current: GeneralActionView[], incoming: GeneralActionView[]) {
  const currentById = new Map(current.map((action) => [action.id, action]));
  for (const action of incoming) {
    const existing = currentById.get(action.id);
    if (!existing || (action.revision ?? "") > (existing.revision ?? ""))
      currentById.set(action.id, action);
  }
  return [...currentById.values()];
}

/**
 * The private Actions surface: a capture-first create form leading the owner's
 * active one-time Actions, with a quiet "Resolved" list keeping completed and
 * dismissed ones reachable for reopen without becoming a task inbox (DESIGN.md
 * calm-by-default). A flat Area filter sits between capture and the list — one calm
 * row of chips (capped, no counts) — and Areas are created, renamed, archived, and
 * restored from a low-emphasis dialog so the surface stays uncluttered (ADR 0146).
 * Every mutation flows through the shared owner-scoped lifecycles via server actions;
 * this component owns the optimistic active/resolved/area list state that ties the
 * rows, create form, and filter together (mirrors PersonFollowups).
 */
// The rows, create form, filter, area manager, and review cards are all their own
// components; what remains here is the optimistic list-state orchestration that ties them
// together (mirrors PersonFollowups). Its cognitive score is composition depth plus the
// list-sync hook set, not branching logic — the cyclomatic count is within threshold.
// fallow-ignore-next-line complexity
export function ActionsSurface({
  active,
  areas,
  paused = [],
  people = [],
  resolved = [],
  resolvedTruncated = false,
  resolvedLimit = 20,
  shareableMembers = [],
  suggested = [],
}: {
  active: GeneralActionView[];
  /** Every Area, archived included — active ones drive the filter and picker; all resolve names. */
  areas: GeneralActionAreaView[];
  /** Paused Routines, kept reachable to resume or retire (ADR 0148). */
  paused?: GeneralActionView[];
  /** The owner's people, for linking an Action to a person as context (ADR 0155). */
  people?: ActionPersonOption[];
  resolved?: GeneralActionView[];
  /** The initial resolved load hit the server cap, so older ones aren't shown. */
  resolvedTruncated?: boolean;
  /** Bound passed to the deferred resolved-pane read. */
  resolvedLimit?: number;
  /** Household members an Action can be shared with; empty keeps the surface private-only. */
  shareableMembers?: ShareableActionMember[];
  /** Review-gated Suggested actions awaiting a yes/no, shown above the active list (ADR 0152). */
  suggested?: SuggestedGeneralActionReviewView[];
}) {
  const router = useRouter();
  const [activeList, setActiveList] = useServerSyncedList(
    active,
    actionId,
    sortActive,
    actionRevision,
  );
  const [pausedList, setPausedList] = useServerSyncedList(
    paused,
    actionId,
    undefined,
    actionRevision,
  );
  const [resolvedList, setResolvedList] = useServerSyncedList(
    resolved,
    actionId,
    undefined,
    actionRevision,
  );
  const [areaList, setAreaList] = useServerSyncedList(areas, areaId);
  const [suggestedList, setSuggestedList] = useServerSyncedList(suggested, reviewActionId);
  const [secondaryPeople, setSecondaryPeople] = useState<ActionPersonOption[]>(people);
  const [secondaryMembers, setSecondaryMembers] =
    useState<ShareableActionMember[]>(shareableMembers);
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [suggestedLoaded, setSuggestedLoaded] = useState(false);
  const [composerLoaded, setComposerLoaded] = useState(false);
  const [ledgerLoading, startLedgerTransition] = useTransition();
  const [suggestedLoading, startSuggestedTransition] = useTransition();
  const [composerLoading, startComposerTransition] = useTransition();
  const [secondaryLoadErrors, setSecondaryLoadErrors] = useState<{
    composer: string | null;
    ledger: string | null;
    suggested: string | null;
  }>({ composer: null, ledger: null, suggested: null });
  const [, startLifecycleTransition] = useTransition();
  const [secondaryUndo, setSecondaryUndo] = useState<Record<string, SecondaryUndo>>({});
  const secondaryUndoRef = useRef(new Map<string, SecondaryUndo>());
  const [offLedgerUndoId, setOffLedgerUndoId] = useState<string | null>(null);
  const [secondaryLifecycleError, setSecondaryLifecycleError] = useState<string | null>(null);
  const [secondaryLifecycleNotice, setSecondaryLifecycleNotice] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const activeAreas = useMemo(() => areaList.filter((area) => !area.archived), [areaList]);
  const archivedAreas = useMemo(() => areaList.filter((area) => area.archived), [areaList]);
  const areaNameById = useMemo(
    () => new Map(areaList.map((area) => [area.id, area.name])),
    [areaList],
  );

  // A stale selection (its Area was archived) falls back to showing everything.
  const effectiveAreaId = resolveActiveAreaId(selectedAreaId, activeAreas);
  const selectedAreaName = effectiveAreaId ? areaNameById.get(effectiveAreaId) : null;

  const visibleActive = filterActionsByArea(activeList, effectiveAreaId);
  const visiblePaused = filterActionsByArea(pausedList, effectiveAreaId);
  const visibleResolved = filterActionsByArea(resolvedList, effectiveAreaId);
  // Suggested proposals honor the active Area filter too, so filtering by an Area scopes
  // the whole surface. A proposal without an Area shows only in the unfiltered view.
  const visibleSuggested = effectiveAreaId
    ? suggestedList.filter((review) => review.action.areaId === effectiveAreaId)
    : suggestedList;
  const { visible: visibleChips, overflow: chipOverflow } = pickVisibleAreaChips(
    activeAreas,
    effectiveAreaId,
  );

  function loadSecondaryLedger() {
    if (ledgerLoaded || ledgerLoading) return;
    setSecondaryLoadErrors((current) => ({ ...current, ledger: null }));
    startLedgerTransition(async () => {
      try {
        const result = await getActionSecondaryLedgerViewsAction({ resolvedLimit });
        setPausedList((current) => mergeByRevision(current, result.paused));
        setResolvedList((current) => mergeByRevision(current, result.resolved));
        setLedgerLoaded(true);
      } catch {
        setSecondaryLoadErrors((current) => ({
          ...current,
          ledger: "Unable to load more actions. Try again.",
        }));
      }
    });
  }

  function loadComposerOptions() {
    if (composerLoaded || composerLoading) return;
    setSecondaryLoadErrors((current) => ({ ...current, composer: null }));
    startComposerTransition(async () => {
      try {
        const result = await getActionComposerOptionsAction();
        setSecondaryPeople(result.people);
        setSecondaryMembers(result.shareableMembers);
        setComposerLoaded(true);
      } catch {
        setSecondaryLoadErrors((current) => ({
          ...current,
          composer: "Unable to load action details. Try again.",
        }));
      }
    });
  }

  function loadSuggested() {
    if (suggestedLoaded || suggestedLoading) return;
    setSecondaryLoadErrors((current) => ({ ...current, suggested: null }));
    startSuggestedTransition(async () => {
      try {
        const result = await getSuggestedActionViewsAction();
        setSuggestedList(result.suggested);
        setSuggestedLoaded(true);
      } catch {
        setSecondaryLoadErrors((current) => ({
          ...current,
          suggested: "Unable to load suggested actions. Try again.",
        }));
      }
    });
  }

  function reconcileResolvedActive(view: GeneralActionView) {
    setActiveList((current) => current.filter((action) => action.id !== view.id));
    if (view.status === "paused") {
      setPausedList((current) => [...current.filter((action) => action.id !== view.id), view]);
    } else if (view.status === "completed" || view.status === "dismissed") {
      setResolvedList((current) => [...current.filter((action) => action.id !== view.id), view]);
    }
    router.refresh();
  }

  function clearSecondaryUndo(actionId: string) {
    secondaryUndoRef.current.delete(actionId);
    setOffLedgerUndoId((current) => (current === actionId ? null : current));
    setSecondaryUndo((current) => {
      const { [actionId]: _removed, ...rest } = current;
      return rest;
    });
  }

  function focusSecondaryControl(actionId: string, control: "archive" | "reopen" | "resume") {
    document
      .querySelector<HTMLButtonElement>(`#action-${actionId} [data-action-control=${control}]`)
      ?.focus();
  }

  function runSecondaryUndo(actionId: string) {
    const entry = secondaryUndoRef.current.get(actionId);
    if (!entry) return;
    entry.requested = true;
    setSecondaryUndo((current) => ({ ...current, [actionId]: { ...entry } }));
    if (entry.originalPending) return;
    startLifecycleTransition(async () => {
      try {
        const result = await entry.inverse();
        if (!result.ok) {
          entry.requested = false;
          entry.error = result.error;
          setSecondaryUndo((current) => ({ ...current, [actionId]: { ...entry } }));
          return;
        }
        entry.applyInverse(result.view);
        clearSecondaryUndo(actionId);
      } catch {
        entry.requested = false;
        entry.error = "Unable to undo the change. Try again.";
        setSecondaryUndo((current) => ({ ...current, [actionId]: { ...entry } }));
      }
    });
  }

  function beginSecondaryLifecycle(input: {
    action: GeneralActionView;
    optimistic: GeneralActionView;
    label: string;
    original: () => Promise<GeneralActionMutationResult>;
    inverse: () => Promise<GeneralActionMutationResult>;
    applyOptimistic: () => void;
    restore: () => void;
    applyOriginal: (view: GeneralActionView) => void;
    applyInverse: (view: GeneralActionView) => void;
    restoreFocus?: () => void;
  }) {
    setSecondaryLifecycleError(null);
    setSecondaryLifecycleNotice(`${input.label}ing action…`);
    const entry: SecondaryUndo = {
      label: input.label,
      originalPending: true,
      requested: false,
      inverse: input.inverse,
      applyInverse: input.applyInverse,
    };
    secondaryUndoRef.current.set(input.action.id, entry);
    setSecondaryUndo((current) => ({ ...current, [input.action.id]: entry }));
    input.applyOptimistic();
    startLifecycleTransition(async () => {
      try {
        const result = await input.original();
        if (!result.ok) {
          input.restore();
          clearSecondaryUndo(input.action.id);
          setSecondaryLifecycleError(result.error);
          setSecondaryLifecycleNotice(null);
          if (input.restoreFocus) requestAnimationFrame(input.restoreFocus);
          return;
        }
        input.applyOriginal(result.view);
        entry.originalPending = false;
        setSecondaryUndo((current) => ({ ...current, [input.action.id]: { ...entry } }));
        setSecondaryLifecycleNotice(`${input.label}ed action.`);
        if (entry.requested) runSecondaryUndo(input.action.id);
      } catch {
        input.restore();
        clearSecondaryUndo(input.action.id);
        setSecondaryLifecycleError("Unable to update this action. Try again.");
        setSecondaryLifecycleNotice(null);
        if (input.restoreFocus) requestAnimationFrame(input.restoreFocus);
      }
    });
  }

  function reopenResolved(action: GeneralActionView) {
    const optimistic = { ...action, status: "open" as const, surfaceLabel: "Reopening…" };
    beginSecondaryLifecycle({
      action,
      optimistic,
      label: "Reopen",
      original: () => reopenGeneralActionAction({ generalActionId: action.id }),
      inverse: () => completeGeneralActionAction({ generalActionId: action.id }),
      applyOptimistic: () => {
        setResolvedList((current) => current.filter((item) => item.id !== action.id));
        addActive(optimistic);
      },
      restore: () => {
        setActiveList((current) => current.filter((item) => item.id !== action.id));
        setResolvedList((current) => [...current.filter((item) => item.id !== action.id), action]);
      },
      applyOriginal: updateActive,
      applyInverse: reconcileResolvedActive,
      restoreFocus: () => focusSecondaryControl(action.id, "reopen"),
    });
  }

  function resumePausedOptimistically(action: GeneralActionView) {
    const optimistic = { ...action, status: "open" as const, surfaceLabel: "Resuming…" };
    beginSecondaryLifecycle({
      action,
      optimistic,
      label: "Resume",
      original: () => resumeGeneralActionAction({ generalActionId: action.id }),
      inverse: () => pauseGeneralActionAction({ generalActionId: action.id }),
      applyOptimistic: () => {
        setPausedList((current) => current.filter((item) => item.id !== action.id));
        addActive(optimistic);
      },
      restore: () => {
        setActiveList((current) => current.filter((item) => item.id !== action.id));
        setPausedList((current) => [...current.filter((item) => item.id !== action.id), action]);
      },
      applyOriginal: updateActive,
      applyInverse: reconcileResolvedActive,
      restoreFocus: () => focusSecondaryControl(action.id, "resume"),
    });
  }

  function archiveSecondary(action: GeneralActionView, source: "paused" | "resolved") {
    setOffLedgerUndoId(action.id);
    beginSecondaryLifecycle({
      action,
      optimistic: action,
      label: "Archive",
      original: () => archiveGeneralActionAction({ generalActionId: action.id }),
      inverse: () => restoreGeneralActionAction({ generalActionId: action.id }),
      applyOptimistic: () => {
        if (source === "paused") {
          setPausedList((current) => current.filter((item) => item.id !== action.id));
        } else {
          setResolvedList((current) => current.filter((item) => item.id !== action.id));
        }
      },
      restore: () => {
        if (source === "paused") {
          setPausedList((current) => [...current.filter((item) => item.id !== action.id), action]);
        } else {
          setResolvedList((current) => [
            ...current.filter((item) => item.id !== action.id),
            action,
          ]);
        }
      },
      applyOriginal: () => undefined,
      applyInverse: addActive,
      restoreFocus: () => focusSecondaryControl(action.id, "archive"),
    });
  }

  function updateActive(view: GeneralActionView) {
    setActiveList((current) =>
      sortActive(current.map((action) => (action.id === view.id ? view : action))),
    );
    router.refresh();
  }

  function addActive(view: GeneralActionView) {
    setActiveList((current) => sortActive([view, ...current.filter((a) => a.id !== view.id)]));
    router.refresh();
  }

  // A reviewed proposal leaves the Suggested list; an accepted one re-enters as an
  // active Action on the next server sync (the card triggers router.refresh).
  function removeSuggested(id: string) {
    setSuggestedList((current) => current.filter((review) => review.action.id !== id));
  }

  function updateSuggested(view: SuggestedGeneralActionReviewView) {
    setSuggestedList((current) =>
      current.map((review) => (review.action.id === view.action.id ? view : review)),
    );
  }

  function addArea(view: GeneralActionAreaView) {
    setAreaList((current) => [...current.filter((area) => area.id !== view.id), view]);
    router.refresh();
  }

  function replaceArea(view: GeneralActionAreaView) {
    setAreaList((current) => current.map((area) => (area.id === view.id ? view : area)));
    router.refresh();
  }

  function markArchived(id: string) {
    setAreaList((current) =>
      current.map((area) => (area.id === id ? { ...area, archived: true } : area)),
    );
    if (selectedAreaId === id) {
      setSelectedAreaId(null);
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <CreateActionForm
        areas={activeAreas}
        defaultAreaId={effectiveAreaId}
        detailsLoadError={secondaryLoadErrors.composer}
        key={effectiveAreaId ?? "all"}
        onCreate={addActive}
        onDetailsRequested={loadComposerOptions}
        people={secondaryPeople}
        shareableMembers={secondaryMembers}
      />
      {secondaryLifecycleError ? (
        <p className="text-[length:var(--text-caption)] text-destructive" role="alert">
          {secondaryLifecycleError}
        </p>
      ) : null}
      {secondaryLifecycleNotice ? <p role="status">{secondaryLifecycleNotice}</p> : null}
      {offLedgerUndoId && secondaryUndo[offLedgerUndoId] ? (
        <div className="flex items-center gap-2" role="status">
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            Action archived.
          </span>
          <Button
            disabled={secondaryUndo[offLedgerUndoId].requested}
            onClick={() => runSecondaryUndo(offLedgerUndoId)}
            size="sm"
            type="button"
            variant="outline"
          >
            {secondaryUndo[offLedgerUndoId].requested ? "Undoing…" : "Undo archive"}
          </Button>
          {secondaryUndo[offLedgerUndoId].error ? (
            <span className="text-[length:var(--text-caption)] text-destructive" role="alert">
              {secondaryUndo[offLedgerUndoId].error}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        {activeAreas.length ? (
          // biome-ignore lint/a11y/useSemanticElements: a toggle-button filter group, not a form fieldset
          <div
            aria-label="Filter by area"
            className="flex flex-wrap items-center gap-1.5 sm:flex-1"
            role="group"
          >
            <AreaChip onSelect={() => setSelectedAreaId(null)} selected={effectiveAreaId === null}>
              All
            </AreaChip>
            {visibleChips.map((area) => (
              <AreaChip
                key={area.id}
                onSelect={() => setSelectedAreaId(area.id)}
                selected={effectiveAreaId === area.id}
              >
                {area.name}
              </AreaChip>
            ))}
            {chipOverflow > 0 ? (
              <button
                className="rounded-full border border-dashed border-border px-3 py-1 text-[length:var(--text-small)] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => {
                  setManagerOpen(true);
                }}
                type="button"
              >
                +{chipOverflow} more
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-[length:var(--text-small)] text-muted-foreground sm:flex-1">
            No areas yet. Areas group related actions.
          </span>
        )}
        <Button
          className="self-start text-muted-foreground sm:shrink-0 sm:self-auto"
          onClick={() => {
            setManagerOpen(true);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <SlidersHorizontalIcon />
          {activeAreas.length ? "Manage areas" : "Add areas"}
        </Button>
      </div>

      {visibleActive.length ? (
        <LedgerList>
          {visibleActive.map((action) => {
            const undo = secondaryUndo[action.id];
            return (
              <ActionRow
                action={action}
                areaName={effectiveAreaId ? null : (areaNameById.get(action.areaId ?? "") ?? null)}
                areas={activeAreas}
                key={action.id}
                onResolve={reconcileResolvedActive}
                onUpdate={updateActive}
                secondaryUndo={
                  undo ? { ...undo, onUndo: () => runSecondaryUndo(action.id) } : undefined
                }
                people={secondaryPeople}
                shareableMembers={secondaryMembers}
              />
            );
          })}
        </LedgerList>
      ) : effectiveAreaId ? (
        <LedgerEmpty>
          Nothing in {selectedAreaName} right now. Choose{" "}
          <button
            className="rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => setSelectedAreaId(null)}
            type="button"
          >
            All
          </button>{" "}
          to see everything.
        </LedgerEmpty>
      ) : (
        <LedgerEmpty>
          Nothing on your plate. Actions are things like replacing a filter or renewing a
          subscription.
        </LedgerEmpty>
      )}

      {!ledgerLoaded ? (
        <details
          className="group"
          onToggle={(event) => {
            if (event.currentTarget.open) loadSecondaryLedger();
          }}
        >
          <summary className="cursor-pointer list-none text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground">
            More action views
          </summary>
          <p
            aria-live="polite"
            className="mt-2 text-[length:var(--text-small)] text-muted-foreground"
          >
            {ledgerLoading
              ? "Loading paused, resolved, and suggested actions…"
              : (secondaryLoadErrors.ledger ?? "Open to load more.")}
          </p>
          {secondaryLoadErrors.ledger ? (
            <Button
              className="mt-2"
              onClick={loadSecondaryLedger}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          ) : null}
        </details>
      ) : null}

      {!suggestedLoaded ? (
        <details
          className="group"
          onToggle={(event) => {
            if (event.currentTarget.open) loadSuggested();
          }}
        >
          <summary className="cursor-pointer list-none text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground">
            Suggested actions
          </summary>
          {suggestedLoading || secondaryLoadErrors.suggested ? (
            <div className="mt-2 text-[length:var(--text-small)] text-muted-foreground">
              <p aria-live="polite">
                {suggestedLoading ? "Loading suggested actions…" : secondaryLoadErrors.suggested}
              </p>
              {secondaryLoadErrors.suggested ? (
                <Button
                  className="mt-2"
                  onClick={loadSuggested}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
        </details>
      ) : null}

      {/* Suggested proposals sit below the active ledger — the same after-active order the
          Follow-ups tab uses for its suggestions, so your own actions lead and proposals
          follow as a gentle offer, never ahead of what you chose (ADR 0152). */}
      {visibleSuggested.length ? (
        <section aria-label="Suggested actions" className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <h2 className="px-1 font-medium text-[length:var(--text-small)] text-muted-foreground">
              Suggested
            </h2>
            <p className="max-w-[68ch] px-1 text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-small-line)]">
              Proposed from your notes. Nothing is added until you accept.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            {visibleSuggested.map((review) => (
              <SuggestedGeneralActionReviewCard
                key={review.action.id}
                onResolve={removeSuggested}
                onUpdate={updateSuggested}
                review={review}
              />
            ))}
          </div>
        </section>
      ) : null}

      {visiblePaused.length ? (
        <details className="group">
          {/* Paused Routines live in their own quiet disclosure — set aside, not
              resolved, and never counted. Resume returns one to the active list; it
              stays reachable rather than lost (ADR 0148). */}
          <summary className="cursor-pointer list-none text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground">
            Paused routines
          </summary>
          <div className="mt-2">
            <LedgerList>
              {visiblePaused.map((action) => (
                <PausedRoutineRow
                  action={action}
                  key={action.id}
                  onArchive={(item) => archiveSecondary(item, "paused")}
                  onResume={resumePausedOptimistically}
                />
              ))}
            </LedgerList>
          </div>
        </details>
      ) : null}

      {visibleResolved.length ? (
        <details className="group">
          {/* No count on purpose: a tally of things you've finished is still a
              number pulling for attention, and the register keeps this surface
              free of counts and badges. The disclosure alone is enough. The
              resolved trail honors the active Area filter too, so filtering by an
              Area scopes the whole surface rather than only its active half. */}
          <summary className="cursor-pointer list-none text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground">
            Resolved
          </summary>
          <div className="mt-2">
            <LedgerList>
              {visibleResolved.map((action) => (
                <ResolvedActionRow
                  action={action}
                  key={action.id}
                  onReopen={reopenResolved}
                  onArchive={(item) => archiveSecondary(item, "resolved")}
                />
              ))}
            </LedgerList>
            {resolvedTruncated && !effectiveAreaId && resolvedList.length >= resolved.length ? (
              <p className="mt-2 px-1 text-[length:var(--text-caption)] text-muted-foreground">
                Showing your most recently resolved actions.
              </p>
            ) : null}
          </div>
        </details>
      ) : null}

      <AreaManagerDialog
        activeAreas={activeAreas}
        archivedAreas={archivedAreas}
        onArchived={markArchived}
        onCreated={addArea}
        onOpenChange={setManagerOpen}
        onRenamed={replaceArea}
        onUnarchived={replaceArea}
        open={managerOpen}
      />
    </div>
  );
}

/**
 * A quiet, keyboard-operable Area filter pill. Selection is carried by fill *and*
 * `aria-pressed` (never color alone; DESIGN.md §8), and uses sage for the current
 * selection so it reads as state, not decoration.
 */
function AreaChip({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-3 py-1 text-[length:var(--text-small)] transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-primary bg-primary font-medium text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
      onClick={onSelect}
      type="button"
    >
      {children}
    </button>
  );
}
