"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  getActionComposerOptionsAction,
  getActionSecondaryLedgerViewsAction,
  getSuggestedActionViewsAction,
} from "@/app/actions/general-actions";
import { AreaManagerDialog } from "@/components/general-action-area-manager";
import { CreateActionForm } from "@/components/general-action-create-form";
import { PausedRoutineRow } from "@/components/general-action-paused-row";
import type { ActionPersonOption } from "@/components/general-action-people-field";
import { ResolvedActionRow } from "@/components/general-action-resolved-row";
import { ActionRow } from "@/components/general-action-row";
import { ErrorText } from "@/components/general-action-shared";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { ChevronDownIcon, SlidersHorizontalIcon } from "@/components/icons";
import { LedgerList } from "@/components/person-ledger";
import { SuggestedGeneralActionReviewCard } from "@/components/suggested-general-action-review";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  filterActionsByArea,
  pickVisibleAreaChips,
  resolveActiveAreaId,
} from "@/lib/general-action-area-filter";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import type { GeneralActionView } from "@/lib/general-action-view";
import { acceptMutationRevision } from "@/lib/mutation-revision";
import {
  type ReversibleMutationApplyPhase,
  ReversibleMutationProvider,
} from "@/lib/reversible-mutation";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import { useDeepLinkReveal } from "@/lib/use-deep-link-highlight";
import { reconcileRevisionedItems, useServerSyncedList } from "@/lib/use-server-synced-list";

/** The Area filter's "everything" option; `null` selection in toggle-group terms. */
const ALL_AREAS = "all";

/** Anchor prefix the Action rows publish as their element id (`action-<id>`). */
const ACTION_ANCHOR_PREFIX = "action-";

const actionId = (action: GeneralActionView) => action.id;
const actionRevision = (action: GeneralActionView) => action.revision;
const areaId = (area: GeneralActionAreaView) => area.id;
const reviewActionId = (review: SuggestedGeneralActionReviewView) => review.action.id;
type ActionList = "active" | "paused" | "resolved";
type DisplacedAction = { index: number; source: ActionList };

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

/**
 * The private Actions surface: a capture-first create form leading the owner's
 * active one-time Actions, with a quiet secondary shelf below a hairline keeping
 * suggestions, paused routines, and resolved work reachable without becoming a task
 * inbox (DESIGN.md calm-by-default). Each shelf section names itself, folds
 * independently, and fetches on open while staying open - see {@link ActionShelf}.
 * A flat Area filter sits between capture and the list - one calm
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
type ActionsSurfaceProps = {
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
};

export function ActionsSurface(props: ActionsSurfaceProps) {
  return (
    <ReversibleMutationProvider>
      <ActionsSurfaceContent {...props} />
    </ReversibleMutationProvider>
  );
}

// fallow-ignore-next-line complexity -- this component coordinates independently extracted surface sections and list-sync hooks.
function ActionsSurfaceContent({
  active,
  areas,
  paused = [],
  people = [],
  resolved = [],
  resolvedTruncated = false,
  resolvedLimit = 20,
  shareableMembers = [],
  suggested = [],
}: ActionsSurfaceProps) {
  const router = useRouter();
  const acknowledgedRevisions = useRef(new Map<string, string>());
  const displacedActions = useRef(new Map<string, DisplacedAction>());
  const acceptServerAction = (action: GeneralActionView) => {
    const acknowledged = acknowledgedRevisions.current.get(action.id);
    return !acknowledged || action.revision > acknowledged;
  };
  const [activeList, setActiveList] = useServerSyncedList(
    active,
    actionId,
    sortActive,
    actionRevision,
    acceptServerAction,
  );
  const [pausedList, setPausedList] = useServerSyncedList(
    paused,
    actionId,
    undefined,
    actionRevision,
    acceptServerAction,
  );
  const [resolvedList, setResolvedList] = useServerSyncedList(
    resolved,
    actionId,
    undefined,
    actionRevision,
    acceptServerAction,
  );
  const [areaList, setAreaList] = useServerSyncedList(areas, areaId);
  const [suggestedList, setSuggestedList] = useServerSyncedList(suggested, reviewActionId);
  const [secondaryPeople, setSecondaryPeople] = useState<ActionPersonOption[]>(people);
  const [secondaryMembers, setSecondaryMembers] =
    useState<ShareableActionMember[]>(shareableMembers);
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [suggestedLoaded, setSuggestedLoaded] = useState(false);
  const [composerLoaded, setComposerLoaded] = useState(false);
  // Each secondary shelf owns its own open flag, decoupled from whether its data has
  // arrived: opening one triggers the fetch and the section stays open through it,
  // rather than the disclosure unmounting itself the moment the flag flips. A shelf the
  // server already filled starts open (there is nothing to wait for); one that has to be
  // fetched starts folded.
  const [suggestedOpen, setSuggestedOpen] = useState(suggested.length > 0);
  const [pausedOpen, setPausedOpen] = useState(paused.length > 0);
  const [resolvedOpen, setResolvedOpen] = useState(resolved.length > 0);
  // The Action a deep link is trying to land on, held until this surface can make its row
  // visible. See the reveal wiring below.
  const [revealActionId, setRevealActionId] = useState<string | null>(null);
  // Paused and Resolved deliberately share one loading and one error: they are two
  // halves of a single secondary-ledger read, so opening either fetches both and
  // splitting the state would only let one of them report a failure the other had.
  const [ledgerLoading, startLedgerTransition] = useTransition();
  const [suggestedLoading, startSuggestedTransition] = useTransition();
  const [composerLoading, startComposerTransition] = useTransition();
  const [secondaryLoadErrors, setSecondaryLoadErrors] = useState<{
    composer: string | null;
    ledger: string | null;
    suggested: string | null;
  }>({ composer: null, ledger: null, suggested: null });
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
        if (!result.ok) {
          setSecondaryLoadErrors((current) => ({ ...current, ledger: result.error }));
          return;
        }
        setPausedList((current) =>
          reconcileRevisionedItems(
            current,
            result.view.paused.filter(acceptServerAction),
            actionId,
            actionRevision,
          ),
        );
        setResolvedList((current) =>
          reconcileRevisionedItems(
            current,
            result.view.resolved.filter(acceptServerAction),
            actionId,
            actionRevision,
          ),
        );
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
        if (!result.ok) {
          setSecondaryLoadErrors((current) => ({ ...current, composer: result.error }));
          return;
        }
        setSecondaryPeople(result.view.people);
        setSecondaryMembers(result.view.shareableMembers);
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
        if (!result.ok) {
          setSecondaryLoadErrors((current) => ({ ...current, suggested: result.error }));
          return;
        }
        setSuggestedList(result.view.suggested);
        setSuggestedLoaded(true);
      } catch {
        setSecondaryLoadErrors((current) => ({
          ...current,
          suggested: "Unable to load suggested actions. Try again.",
        }));
      }
    });
  }

  // Deep-link landing for rows this surface can show but has not rendered. `/actions#action-<id>`
  // is linked from Action Today, asset profiles, and Eve's review cards, and it can name a
  // resolved or paused Action - rows that only exist once their shelf is opened and the
  // secondary read returns. Claiming the id starts that read; the effect below then reveals
  // whichever shelf turns out to hold it, and `useDeepLinkHighlight` waits for the row to
  // render before scrolling and highlighting it.
  useDeepLinkReveal((elementId) => {
    if (!elementId.startsWith(ACTION_ANCHOR_PREFIX)) return false;
    const id = elementId.slice(ACTION_ANCHOR_PREFIX.length);
    if (!id) return false;
    setRevealActionId(id);
    loadSecondaryLedger();
    return true;
  });

  useEffect(() => {
    if (!revealActionId) return;
    // Active rows are already on screen, so this only has to unfold or unfilter; paused and
    // resolved need their shelf open as well.
    const shelves = [
      { actions: activeList, open: null },
      { actions: pausedList, open: setPausedOpen },
      { actions: resolvedList, open: setResolvedOpen },
    ] as const;
    for (const { actions, open } of shelves) {
      const action = actions.find((candidate) => candidate.id === revealActionId);
      if (!action) continue;
      open?.(true);
      // An Area filter keeps the row out of the DOM even with its shelf open, so landing on
      // a row from another Area means stepping back to every Area.
      if (effectiveAreaId && action.areaId !== effectiveAreaId) setSelectedAreaId(null);
      setRevealActionId(null);
      return;
    }
    // The read finished and no list holds it - a stale or foreign link. Stop looking; the
    // highlight simply never happens, with no error and no jump.
    if (ledgerLoaded) setRevealActionId(null);
  }, [activeList, effectiveAreaId, ledgerLoaded, pausedList, resolvedList, revealActionId]);

  function removeUnlessNewer(
    current: GeneralActionView[],
    view: GeneralActionView,
    source: ActionList,
  ) {
    const index = current.findIndex((item) => item.id === view.id);
    if (index >= 0 && !displacedActions.current.has(view.id)) {
      displacedActions.current.set(view.id, { index, source });
    }
    return current.filter((item) => item.id !== view.id || item.revision > view.revision);
  }

  function restoreDisplacedPosition(
    current: GeneralActionView[],
    view: GeneralActionView,
    destination: ActionList,
  ) {
    const displaced = displacedActions.current.get(view.id);
    const reconciled = reconcileRevisionedItems(current, [view], actionId, actionRevision);
    if (!displaced || displaced.source !== destination) return reconciled;
    displacedActions.current.delete(view.id);
    const withoutView = reconciled.filter((item) => item.id !== view.id);
    const index = Math.min(displaced.index, withoutView.length);
    return [...withoutView.slice(0, index), view, ...withoutView.slice(index)];
  }

  function applyGeneralActionView(
    view: GeneralActionView,
    phase: ReversibleMutationApplyPhase = "authoritative",
  ) {
    if (phase === "projection") displacedActions.current.delete(view.id);
    if (!acceptMutationRevision(acknowledgedRevisions.current, view, phase)) return false;
    const activeDestination = view.status === "open" || view.status === "deferred";
    const pausedDestination = view.status === "paused";
    const resolvedDestination = view.status === "completed" || view.status === "dismissed";
    setActiveList((current) =>
      activeDestination
        ? sortActive(restoreDisplacedPosition(current, view, "active"))
        : removeUnlessNewer(current, view, "active"),
    );
    setPausedList((current) =>
      pausedDestination
        ? restoreDisplacedPosition(current, view, "paused")
        : removeUnlessNewer(current, view, "paused"),
    );
    setResolvedList((current) =>
      resolvedDestination
        ? restoreDisplacedPosition(current, view, "resolved")
        : removeUnlessNewer(current, view, "resolved"),
    );
    router.refresh();
    return true;
  }

  function updateActive(view: GeneralActionView, phase?: ReversibleMutationApplyPhase) {
    return applyGeneralActionView(view, phase);
  }

  function finalizeActionMutation(id: string) {
    window.setTimeout(() => displacedActions.current.delete(id), 0);
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

      <div
        className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
        data-slot="action-filter-bar"
      >
        {activeAreas.length ? (
          <div className="flex flex-wrap items-center gap-1.5 sm:flex-1">
            <ToggleGroup
              aria-label="Filter by area"
              className="flex-wrap"
              onValueChange={(value) =>
                setSelectedAreaId(value && value !== ALL_AREAS ? value : null)
              }
              type="single"
              value={effectiveAreaId ?? ALL_AREAS}
              variant="outline"
            >
              <AreaChip value={ALL_AREAS}>All</AreaChip>
              {visibleChips.map((area) => (
                <AreaChip key={area.id} value={area.id}>
                  {area.name}
                </AreaChip>
              ))}
            </ToggleGroup>
            {chipOverflow > 0 ? (
              // Not a filter value, so it stays outside the group rather than posing as a
              // fourth option; it borrows the chip's shape and height to keep one vocabulary.
              <Button
                className="h-8 rounded-full border-dashed px-3 text-[length:var(--text-small)] text-muted-foreground max-sm:min-h-11"
                onClick={() => {
                  setManagerOpen(true);
                }}
                type="button"
                variant="outline"
              >
                +{chipOverflow} more
              </Button>
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
          {visibleActive.map((action) => (
            <ActionRow
              action={action}
              areaName={effectiveAreaId ? null : (areaNameById.get(action.areaId ?? "") ?? null)}
              areas={activeAreas}
              key={action.id}
              onMutationFinalize={finalizeActionMutation}
              onResolve={applyGeneralActionView}
              onUpdate={updateActive}
              people={secondaryPeople}
              shareableMembers={secondaryMembers}
            />
          ))}
        </LedgerList>
      ) : effectiveAreaId ? (
        <EmptyState
          action={
            <Button
              onClick={() => setSelectedAreaId(null)}
              size="sm"
              type="button"
              variant="outline"
            >
              All
            </Button>
          }
          description="Capture one above, or step back to every area."
          title={`Nothing in ${selectedAreaName} right now.`}
        />
      ) : (
        <EmptyState
          description="Actions are things like replacing a filter or renewing a subscription. Capture the first one above."
          title="Nothing on your plate."
        />
      )}

      {/* The secondary shelf: three named, self-describing sections below a hairline,
          replacing the old "More action views" indirection. Each says what it holds, each
          keeps its own fold, and none of them disappear when their data arrives - opening
          one is what fetches it, and the section that was clicked is the one that shows
          the result (skeleton, then rows or a plain "nothing here" line). Suggested leads
          the shelf because it is the only offer the surface makes; paused and resolved are
          archives you go looking for. */}
      <div className="flex flex-col gap-1 border-t pt-3">
        {/* Suggested proposals sit below the active ledger - the same after-active order
            the Follow-ups tab uses for its suggestions, so your own actions lead and
            proposals follow as a gentle offer, never ahead of what you chose (ADR 0152). */}
        <ActionShelf
          emptyMessage="No suggestions right now."
          error={secondaryLoadErrors.suggested}
          isEmpty={visibleSuggested.length === 0}
          label="Suggested actions"
          loading={suggestedLoading}
          onLoad={loadSuggested}
          onOpenChange={setSuggestedOpen}
          open={suggestedOpen}
        >
          <p className="max-w-[68ch] px-1 text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-small-line)]">
            Proposed from your notes. Nothing is added until you accept.
          </p>
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
        </ActionShelf>

        {/* Paused Routines are set aside, not resolved, and never counted. Resume returns
            one to the active list; it stays reachable rather than lost (ADR 0148). */}
        <ActionShelf
          emptyMessage="No paused routines."
          error={secondaryLoadErrors.ledger}
          isEmpty={visiblePaused.length === 0}
          label="Paused routines"
          loading={ledgerLoading}
          onLoad={loadSecondaryLedger}
          onOpenChange={setPausedOpen}
          open={pausedOpen}
        >
          <LedgerList>
            {visiblePaused.map((action) => (
              <PausedRoutineRow
                action={action}
                key={action.id}
                onMutationFinalize={finalizeActionMutation}
                onUpdate={applyGeneralActionView}
              />
            ))}
          </LedgerList>
        </ActionShelf>

        {/* No count on purpose: a tally of things you've finished is still a number
            pulling for attention, and the register keeps this surface free of counts and
            badges. The resolved trail honors the active Area filter too, so filtering by
            an Area scopes the whole surface rather than only its active half. */}
        <ActionShelf
          emptyMessage="Nothing resolved yet."
          error={secondaryLoadErrors.ledger}
          isEmpty={visibleResolved.length === 0}
          label="Resolved"
          loading={ledgerLoading}
          onLoad={loadSecondaryLedger}
          onOpenChange={setResolvedOpen}
          open={resolvedOpen}
        >
          <LedgerList>
            {visibleResolved.map((action) => (
              <ResolvedActionRow
                action={action}
                key={action.id}
                onMutationFinalize={finalizeActionMutation}
                onUpdate={applyGeneralActionView}
              />
            ))}
          </LedgerList>
          {resolvedTruncated && !effectiveAreaId && resolvedList.length >= resolved.length ? (
            <p className="px-1 text-[length:var(--text-caption)] text-muted-foreground">
              Showing your most recently resolved actions.
            </p>
          ) : null}
        </ActionShelf>
      </div>

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
 * A quiet Area filter pill, one option of the single-select filter group.
 *
 * Built on the shared `ToggleGroupItem` rather than a hand-rolled `aria-pressed`
 * button: the Areas are mutually exclusive, so Radix's single-select group is the
 * honest semantic (a radio group, arrow-key traversable, one tab stop for the whole
 * row) and the toggle variants carry the resting outline treatment. Selection is
 * carried by fill *and* `aria-checked` - never color alone (DESIGN.md §8) - and the
 * current selection takes sage, which §3 reserves for exactly this.
 */
function AreaChip({ children, value }: { children: React.ReactNode; value: string }) {
  return (
    <ToggleGroupItem
      className="rounded-full px-3 text-[length:var(--text-small)] max-sm:min-h-11 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground"
      value={value}
    >
      {children}
    </ToggleGroupItem>
  );
}

/**
 * One folded section of the secondary shelf (Suggested, Paused routines, Resolved).
 *
 * The contract that matters: **a section the owner opens stays open and answers in
 * place.** These sections are lazily fetched, and the previous mechanic tied the
 * disclosure's existence to the not-yet-loaded flag, so opening one unmounted it and
 * the click read as the control deleting itself. Here `open` is owner state and the
 * fetch is a side effect of opening, so the fold survives the load and resolves into
 * one of three visible answers: a reserve shaped like the rows, the rows themselves,
 * or a plain line saying there are none. Never silence.
 *
 * The fetch-on-open rule lives here rather than at each call site: a shelf hands over
 * its idempotent `onLoad` and this decides when to run it, so a fourth shelf cannot
 * arrive with the load quietly left off its open handler.
 *
 * The state line sits in a live region that is mounted with the section, so the
 * reserve-to-answer swap is announced to a screen reader rather than happening
 * silently after the fold's own announcement.
 */
function ActionShelf({
  children,
  emptyMessage,
  error,
  isEmpty,
  label,
  loading,
  onLoad,
  onOpenChange,
  open,
}: {
  children: React.ReactNode;
  /** Plain statement shown once the section is loaded and has nothing in it. */
  emptyMessage: string;
  error: string | null;
  isEmpty: boolean;
  label: string;
  loading: boolean;
  /** Idempotent fetch for this section's rows. Run on open, and again on Retry. */
  onLoad: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Collapsible
      className="flex flex-col gap-2"
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) onLoad();
      }}
      open={open}
    >
      {/* `min-h-11` is the 44px touch target; the row is only as wide as its label so it
          never reads as a full-width bar. The chevron is the affordance the old
          `list-none` summaries threw away, which left them looking like footer captions. */}
      <CollapsibleTrigger className="group -mx-1.5 flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1.5 text-left text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-150 ease-(--motion-ease-out) group-data-[state=open]:rotate-180"
        />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pb-1">
        {isEmpty ? null : children}
        <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
          {isEmpty && loading ? <ShelfReserve label={`Loading ${label.toLowerCase()}`} /> : null}
          {isEmpty && !loading && !error ? (
            <p className="px-1 text-[length:var(--text-small)] text-muted-foreground">
              {emptyMessage}
            </p>
          ) : null}
        </div>
        {error ? (
          <div className="flex flex-col items-start gap-2">
            <ErrorText message={error} />
            <Button onClick={onLoad} size="sm" type="button" variant="outline">
              Retry
            </Button>
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The 0-to-arrival state of a shelf: one ledger row's geometry rather than a spinner,
 * so the section does not jump when the real rows land (DESIGN.md §6 loading).
 */
function ShelfReserve({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex animate-pulse flex-col gap-2 px-4 py-3.5">
        <span className="h-[1em] w-[24ch] max-w-full rounded bg-muted text-[length:var(--text-body)]" />
        <span className="h-[1em] w-[11ch] max-w-full rounded bg-muted text-[length:var(--text-caption)]" />
      </div>
    </div>
  );
}
