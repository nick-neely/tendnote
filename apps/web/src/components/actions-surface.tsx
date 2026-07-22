"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AreaManagerDialog } from "@/components/general-action-area-manager";
import { CreateActionForm } from "@/components/general-action-create-form";
import { PausedRoutineRow } from "@/components/general-action-paused-row";
import type { ActionPersonOption } from "@/components/general-action-people-field";
import { ResolvedActionRow } from "@/components/general-action-resolved-row";
import { ActionRow } from "@/components/general-action-row";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { SuggestedGeneralActionReviewCard } from "@/components/suggested-general-action-review";
import { Button } from "@/components/ui/button";
import {
  filterActionsByArea,
  pickVisibleAreaChips,
  resolveActiveAreaId,
} from "@/lib/general-action-area-filter";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import type { GeneralActionView } from "@/lib/general-action-view";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import { useServerSyncedList } from "@/lib/use-server-synced-list";
import { cn } from "@/lib/utils";

const actionId = (action: GeneralActionView) => action.id;
const areaId = (area: GeneralActionAreaView) => area.id;
const reviewActionId = (review: SuggestedGeneralActionReviewView) => review.action.id;

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
  resolved,
  resolvedTruncated = false,
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
  resolved: GeneralActionView[];
  /** The initial resolved load hit the server cap, so older ones aren't shown. */
  resolvedTruncated?: boolean;
  /** Household members an Action can be shared with; empty keeps the surface private-only. */
  shareableMembers?: ShareableActionMember[];
  /** Review-gated Suggested actions awaiting a yes/no, shown above the active list (ADR 0152). */
  suggested?: SuggestedGeneralActionReviewView[];
}) {
  const router = useRouter();
  const [activeList, setActiveList] = useServerSyncedList(active, actionId, sortActive);
  const [pausedList, setPausedList] = useServerSyncedList(paused, actionId);
  const [resolvedList, setResolvedList] = useServerSyncedList(resolved, actionId);
  const [areaList, setAreaList] = useServerSyncedList(areas, areaId);
  const [suggestedList, setSuggestedList] = useServerSyncedList(suggested, reviewActionId);
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

  function removeActive(id: string) {
    setActiveList((current) => current.filter((action) => action.id !== id));
    router.refresh();
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

  function removeResolved(id: string) {
    setResolvedList((current) => current.filter((action) => action.id !== id));
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

  function removePaused(id: string) {
    setPausedList((current) => current.filter((action) => action.id !== id));
    router.refresh();
  }

  // Resuming a paused Routine returns it to the active list under its cadence.
  function resumePaused(view: GeneralActionView) {
    setPausedList((current) => current.filter((action) => action.id !== view.id));
    addActive(view);
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
        key={effectiveAreaId ?? "all"}
        onCreate={addActive}
        people={people}
        shareableMembers={shareableMembers}
      />

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
                onClick={() => setManagerOpen(true)}
                type="button"
              >
                +{chipOverflow} more
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-[length:var(--text-small)] text-muted-foreground sm:flex-1">
            No areas yet — add one to group your actions.
          </span>
        )}
        <Button
          className="self-start text-muted-foreground sm:shrink-0 sm:self-auto"
          onClick={() => setManagerOpen(true)}
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
              onResolve={removeActive}
              onUpdate={updateActive}
              people={people}
              shareableMembers={shareableMembers}
            />
          ))}
        </LedgerList>
      ) : effectiveAreaId ? (
        <LedgerEmpty>
          Nothing in {selectedAreaName} right now. Add an action above, or choose{" "}
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
          Nothing on your plate. Add an action above — something to do that isn't tied to a person,
          like replacing a filter or renewing a subscription.
        </LedgerEmpty>
      )}

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
              Proposed from your notes. Accept to add one to your actions, edit it first, or set it
              aside — nothing is added until you accept.
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
                  onResolve={removePaused}
                  onResume={resumePaused}
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
                  onReopen={addActive}
                  onResolve={removeResolved}
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
