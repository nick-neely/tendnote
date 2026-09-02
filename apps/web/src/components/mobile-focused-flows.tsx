"use client";

import type {
  GlobalRecallFilter,
  GlobalRecallMatchKind,
  GlobalRecallResponse,
} from "@tendnote/domain/global-recall";
import Link from "next/link";
import { type ReactNode, type RefObject, Suspense, use, useEffect, useRef, useState } from "react";
import {
  destinationsInGroup,
  NO_VIEWER_STANDINGS_RESOLVED,
  type ViewerStandings,
} from "@/components/app-destinations";
import { ArrowLeftIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "@/components/icons";
import { type CaptureHandlers, MobileCaptureFlow } from "@/components/mobile-capture-flow";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { ThemeSegmentedControl } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  globalRecallStorageKey,
  markGlobalRecallReturn,
  readGlobalRecallState,
} from "@/lib/global-recall-navigation";
import { recallResultLines } from "@/lib/recall-result-lines";
import {
  GLOBAL_RECALL_FAMILY_OPTIONS,
  GLOBAL_RECALL_MATCH_OPTIONS,
  type GlobalRecallFilters,
  type GlobalRecallHandler,
  type GlobalRecallSearch,
  useGlobalRecall,
} from "@/lib/use-global-recall";

export type FocusedFlow = "search" | "capture" | "menu";

export type { CaptureHandlers } from "@/components/mobile-capture-flow";
export type { GlobalRecallHandler };

function FullScreenFlow({
  children,
  description,
  initialFocusRef,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  title: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="inset-0 top-0 left-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-x-hidden rounded-none p-0"
        onOpenAutoFocus={(event) => {
          if (!initialFocusRef?.current) return;
          event.preventDefault();
          initialFocusRef.current.focus();
        }}
        showCloseButton={false}
      >
        {/* One heading per overlay: the visible bar title *is* the dialog's
            accessible name, rather than a screen-reader-only copy of it sitting
            above a second, identical <h2>. */}
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {/* The bar is inset by the gutter like everything under it, and the back
            control is pulled back out by its own inner padding so the *glyph* -
            not the invisible 44px touch target around it - lands on the same
            line as the field and the results below. */}
        <header className="flex min-h-14 items-center gap-2 border-b px-gutter pt-[env(safe-area-inset-top)]">
          <Button
            aria-label="Close"
            className="-ml-3.5 size-11"
            onClick={onClose}
            size="icon-lg"
            variant="ghost"
          >
            <ArrowLeftIcon aria-hidden />
          </Button>
          <DialogTitle className="font-semibold text-base">{title}</DialogTitle>
        </header>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function SearchFlow({
  onClose,
  onNavigate,
  ownerUserId,
  query,
  search,
  setQuery,
}: {
  onClose: () => void;
  onNavigate: () => void;
  ownerUserId: string;
  query: string;
  search: GlobalRecallHandler;
  setQuery: (query: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const restoredScrollRef = useRef<number | null>(null);
  const restoredFocusRef = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  // The folded narrowings start folded on every open, including a restored one:
  // the trigger's count already reports that a search is narrowed, so unfolding
  // the panel would spend the top of the screen re-stating it.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const storageKey = globalRecallStorageKey(ownerUserId);
  const recall = useGlobalRecall({ query, search });
  const { failed, failureMessage, loading, response } = recall;
  const { family, includeArchived, includeRestricted, matchKind } = recall.filters;
  useRestoreRecallState({
    restoreFilters: recall.restoreFilters,
    restoredFocusRef,
    restoredScrollRef,
    setExpanded,
    setQuery,
    storageKey,
  });
  useRestoreRecallPosition({
    response,
    restoredFocusRef,
    restoredScrollRef,
    resultsRef,
    storageKey,
  });

  function rememberState(focusedKey?: string) {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        query,
        family,
        matchKind,
        includeArchived,
        includeRestricted,
        expanded,
        focusedKey: focusedKey ?? null,
        restoreFocus: Boolean(focusedKey),
        scrollTop: resultsRef.current?.scrollTop ?? 0,
      }),
    );
    if (focusedKey) {
      markGlobalRecallReturn(ownerUserId);
    }
  }

  function toggleExplanation(key: string) {
    setExpanded((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  const { exact, related } = recall;
  const navigateToResult = (key: string) => {
    rememberState(key);
    onNavigate();
  };
  return (
    <FullScreenFlow
      description="Search records visible to you."
      initialFocusRef={inputRef}
      onClose={() => {
        rememberState();
        onClose();
      }}
      title="Search"
    >
      <div className="flex min-h-0 flex-1 flex-col px-gutter py-5">
        <RecallSearchControls
          filtersOpen={filtersOpen}
          inputRef={inputRef}
          query={query}
          recall={recall}
          setFiltersOpen={setFiltersOpen}
          setQuery={setQuery}
        />
        <RecallSearchResults
          exact={exact}
          expanded={expanded}
          failed={failed}
          failureMessage={failureMessage}
          loading={loading}
          onNavigate={navigateToResult}
          onRetry={() => setQuery(`${query} `)}
          onScroll={() => rememberState()}
          onToggle={toggleExplanation}
          related={related}
          response={response}
          resultsRef={resultsRef}
        />
      </div>
    </FullScreenFlow>
  );
}

function useRestoreRecallState(input: {
  storageKey: string;
  setQuery: (value: string) => void;
  restoreFilters: (saved: Partial<GlobalRecallFilters>) => void;
  setExpanded: (value: string[]) => void;
  restoredScrollRef: RefObject<number | null>;
  restoredFocusRef: RefObject<string | null>;
}) {
  const { restoreFilters, restoredFocusRef, restoredScrollRef, setExpanded, setQuery, storageKey } =
    input;
  useEffect(() => {
    const saved = readGlobalRecallState(storageKey);
    if (!saved) return;
    if (saved.query) setQuery(saved.query);
    restoreFilters(saved);
    setExpanded(saved.expanded ?? []);
    restoredScrollRef.current = saved.scrollTop ?? 0;
    restoredFocusRef.current = saved.restoreFocus ? (saved.focusedKey ?? null) : null;
  }, [restoreFilters, restoredFocusRef, restoredScrollRef, setExpanded, setQuery, storageKey]);
}

function useRestoreRecallPosition(input: {
  response: GlobalRecallResponse | null;
  storageKey: string;
  resultsRef: RefObject<HTMLDivElement | null>;
  restoredScrollRef: RefObject<number | null>;
  restoredFocusRef: RefObject<string | null>;
}) {
  const { response, restoredFocusRef, restoredScrollRef, resultsRef, storageKey } = input;
  useEffect(() => {
    if (!response || restoredScrollRef.current === null) return;
    const scrollTop = restoredScrollRef.current;
    restoredScrollRef.current = null;
    requestAnimationFrame(() => {
      if (resultsRef.current) resultsRef.current.scrollTop = scrollTop;
      const focusedKey = restoredFocusRef.current;
      if (!focusedKey) return;
      document.getElementById(resultElementId(focusedKey))?.focus({ preventScroll: true });
      restoredFocusRef.current = null;
      clearStoredFocus(storageKey);
    });
  }, [response, restoredFocusRef, restoredScrollRef, resultsRef, storageKey]);
}

function clearStoredFocus(storageKey: string) {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return;
  const saved = JSON.parse(raw) as Record<string, unknown>;
  sessionStorage.setItem(storageKey, JSON.stringify({ ...saved, restoreFocus: false }));
}

/**
 * The field, then the one narrowing worth a tap, then everything else folded away.
 *
 * This surface used to open onto a 215px panel of chrome - two labelled selects,
 * two checkboxes, and a line of helper text - sitting between the search field
 * and the results on a screen whose entire job is "type a name". Nothing in it
 * was wrong; all of it was asking to be read before the owner had typed a
 * character, and it pushed the first result below the fold.
 *
 * So the panel is now a row. Record type is the narrowing people actually reach
 * for, so it becomes a scrollable strip of chips: one tap instead of opening a
 * select, and the strip doubles as the honest answer to "what can this find?" -
 * which is why the empty state below it no longer has to list the families in
 * prose. Match, archived, and restricted are rarer, so they fold behind one
 * control that says how many of them are currently on.
 */
function RecallSearchControls({
  filtersOpen,
  inputRef,
  query,
  recall,
  setFiltersOpen,
  setQuery,
}: {
  filtersOpen: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  /** The whole search, as the palette's own filter bar takes it. */
  recall: GlobalRecallSearch;
  setFiltersOpen: (value: boolean) => void;
  setQuery: (value: string) => void;
}) {
  const { family, includeArchived, includeRestricted, matchKind } = recall.filters;
  // The "restricted needs one named family" gate lives in `useGlobalRecall`, so
  // `setFamily` already turns the control off when the owner widens back to all.
  const { restrictedLocked } = recall;
  const foldedCount = countFoldedNarrowings({ includeArchived, includeRestricted, matchKind });
  return (
    <>
      <Label className="sr-only" htmlFor="mobile-global-search">
        Search Tendnote
      </Label>
      <div className="flex min-h-12 items-center gap-2 rounded-xl border px-3 focus-within:ring-3 focus-within:ring-ring/35">
        <SearchIcon aria-hidden className="size-4 text-muted-foreground" />
        <input
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          id="mobile-global-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people, Self Context, actions…"
          ref={inputRef}
          value={query}
        />
        {/* Starting over is one tap, not a held backspace. It leaves focus in the
            field so the next word can just be typed. */}
        {query ? (
          <Button
            aria-label="Clear search"
            className="-mr-2 size-9 text-muted-foreground"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            size="icon"
            variant="ghost"
          >
            <XIcon aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>

      <Collapsible onOpenChange={setFiltersOpen} open={filtersOpen}>
        <div className="mt-3 flex items-center gap-1">
          {/* The strip scrolls rather than wraps: seven families wrapped onto two
              rows moved the first result down by a row's worth of chrome every
              time, and a half-shown chip at the edge says "there is more here"
              more plainly than a second row does. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <ToggleGroup
              aria-label="Record type"
              onValueChange={(value) => value && recall.setFamily(value as GlobalRecallFilter)}
              type="single"
              value={family}
              variant="outline"
            >
              {GLOBAL_RECALL_FAMILY_OPTIONS.map((option) => (
                <FilterChip key={option.value} value={option.value}>
                  {option.label}
                </FilterChip>
              ))}
            </ToggleGroup>
          </div>
          <CollapsibleTrigger asChild>
            <Button
              // The count has to be in the *name*, not only in the badge: a name
              // set here replaces the button's contents for anyone listening, so
              // a bare "More filters" would report an un-narrowed search to the
              // one person who cannot see the badge saying otherwise.
              aria-label={foldedCount > 0 ? `More filters, ${foldedCount} on` : "More filters"}
              className="size-11 shrink-0 text-muted-foreground"
              size="icon-lg"
              variant="ghost"
            >
              <SlidersHorizontalIcon aria-hidden />
              {/* The count is the whole reason folding these away is honest: a
                  narrowed search never looks like an un-narrowed one. */}
              {foldedCount > 0 ? (
                <span
                  aria-hidden
                  className="-mt-2 -mr-1 rounded-full bg-primary px-1 font-medium text-[length:var(--text-caption)] text-primary-foreground leading-[var(--text-caption-line)]"
                >
                  {foldedCount}
                </span>
              ) : null}
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="mt-3 flex flex-col gap-3 rounded-xl border bg-panel p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="global-recall-match">Match</Label>
            <Select
              onValueChange={(value) => recall.setMatchKind(value as GlobalRecallMatchKind | "all")}
              value={matchKind}
            >
              <SelectTrigger className="min-h-11 w-full bg-background" id="global-recall-match">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GLOBAL_RECALL_MATCH_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              checked={includeArchived}
              id="global-recall-archived"
              onCheckedChange={(checked) => recall.setIncludeArchived(checked === true)}
            />
            <Label className="min-h-11 flex-1 font-normal" htmlFor="global-recall-archived">
              Include archived
            </Label>
          </div>
          {/* Restricted matches need one named family to reveal. That used to be a
              permanently disabled checkbox with "Pick a record type first."
              underneath it - a control and a line of copy spent saying what
              picking a chip above now demonstrates. */}
          {restrictedLocked ? null : (
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                checked={includeRestricted}
                id="global-recall-restricted"
                onCheckedChange={(checked) => recall.setIncludeRestricted(checked === true)}
              />
              <Label className="min-h-11 flex-1 font-normal" htmlFor="global-recall-restricted">
                Reveal restricted matches
              </Label>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

/**
 * How many of the folded narrowings are currently on. Record type is excluded on
 * purpose: its chip is on screen, so counting it here would report a narrowing
 * the owner can already see as hidden.
 */
function countFoldedNarrowings({
  includeArchived,
  includeRestricted,
  matchKind,
}: {
  includeArchived: boolean;
  includeRestricted: boolean;
  matchKind: GlobalRecallMatchKind | "all";
}): number {
  return [matchKind !== "all", includeArchived, includeRestricted].filter(Boolean).length;
}

function RecallSearchResults({
  exact,
  expanded,
  failed,
  failureMessage,
  loading,
  onNavigate,
  onRetry,
  onScroll,
  onToggle,
  related,
  response,
  resultsRef,
}: {
  exact: GlobalRecallResponse["results"];
  expanded: string[];
  failed: boolean;
  failureMessage: string | null;
  loading: boolean;
  onNavigate: (key: string) => void;
  onRetry: () => void;
  onScroll: () => void;
  onToggle: (key: string) => void;
  related: GlobalRecallResponse["results"];
  response: GlobalRecallResponse | null;
  resultsRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" onScroll={onScroll} ref={resultsRef}>
      {loading ? <SearchResultSkeleton /> : null}
      {failed ? (
        <MobileFailureState kind="app_server" message={failureMessage} onRetry={onRetry} />
      ) : null}
      {response?.limitations.map((limitation) => (
        <p className="border-b py-3 text-muted-foreground text-sm" key={limitation.source}>
          {limitation.message}
        </p>
      ))}
      {/* The surface below the field would otherwise be several hundred pixels of
          nothing until the second keystroke. The record-type strip above already
          names everything this can reach, so the line here is the one thing the
          strip cannot say: what to do. */}
      {!loading && !failed && !response ? (
        <EmptyState className="mt-4" size="compact" title="Type a name or a few words." />
      ) : null}
      {/* "Widen the filters above" would now point partly at controls that are
          folded away. The record-type strip is the one narrowing still on screen,
          so that is the one this can honestly send anyone back to. */}
      {!loading && response && response.results.length === 0 ? (
        <EmptyState
          className="mt-4"
          description="Try different wording, or widen the record type above."
          size="compact"
          title="Nothing matched that search."
        />
      ) : null}
      <RecallResultSection
        expanded={expanded}
        label="Exact"
        onNavigate={onNavigate}
        onToggle={onToggle}
        results={exact}
      />
      <RecallResultSection
        expanded={expanded}
        label="Related"
        onNavigate={onNavigate}
        onToggle={onToggle}
        results={related}
      />
      {response?.hasMore ? (
        <p className="py-4 text-muted-foreground text-sm">
          More matches than fit here. Narrow your search to see them.
        </p>
      ) : null}
    </div>
  );
}

function SearchResultSkeleton() {
  return (
    <div aria-label="Searching records" className="divide-y" role="status">
      {[0, 1, 2].map((row) => (
        <div className="flex min-h-20 flex-col justify-center gap-2 py-3" key={row}>
          <span aria-hidden className="h-3 w-2/5 rounded bg-secondary" />
          <span aria-hidden className="h-3 w-4/5 rounded bg-secondary" />
        </div>
      ))}
    </div>
  );
}

function resultElementId(key: string) {
  return `global-recall-result-${encodeURIComponent(key)}`;
}

export function RecallResultSection({
  expanded,
  label,
  onNavigate,
  onToggle,
  results,
}: {
  expanded: string[];
  label: string;
  onNavigate: (key: string) => void;
  onToggle: (key: string) => void;
  results: GlobalRecallResponse["results"];
}) {
  if (results.length === 0) return null;
  return (
    <section aria-label={`${label} matches`}>
      <h3 className="sticky top-0 border-b bg-background py-2 font-medium text-[length:var(--text-small)] text-muted-foreground">
        {label}
      </h3>
      <div className="divide-y">
        {results.map((result) => {
          const key = `${result.canonical.kind}:${result.canonical.id}`;
          const isExpanded = expanded.includes(key);
          // Both recall surfaces read the same presentation rule, so a memory row
          // leads with what was remembered here exactly as it does in the desktop
          // palette rather than repeating the person's name from the row above.
          const { primary, secondary } = recallResultLines(result);
          return (
            <article className="py-3" key={key}>
              <Link
                className="block min-h-11 rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                href={result.href}
                id={resultElementId(key)}
                onClick={() => onNavigate(key)}
              >
                <span className="block font-medium text-sm">{primary}</span>
                {secondary ? (
                  <span className="mt-1 line-clamp-2 block text-muted-foreground text-sm">
                    {secondary}
                  </span>
                ) : null}
              </Link>
              <div className="mt-1 flex items-center gap-3 text-[length:var(--text-small)] text-muted-foreground">
                <span>{result.visibility?.label ?? result.trust.replaceAll("_", " ")}</span>
                <button
                  aria-expanded={isExpanded}
                  className="min-h-11 rounded-sm px-1 underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:text-foreground"
                  onClick={() => onToggle(key)}
                  type="button"
                >
                  Why this result?
                </button>
              </div>
              {isExpanded ? (
                <p className="pb-2 text-muted-foreground text-sm">
                  {result.match.reason}
                  {result.match.excerpt ? `: ${result.match.excerpt}` : ""}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function CaptureFlow({
  handlers,
  onClose,
  ownerUserId,
}: {
  handlers?: CaptureHandlers;
  onClose: () => void;
  ownerUserId: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <FullScreenFlow
      description="Save a note, reminder, link, or open question."
      initialFocusRef={inputRef}
      onClose={onClose}
      title="Capture"
    >
      <MobileCaptureFlow handlers={handlers} inputRef={inputRef} ownerUserId={ownerUserId} />
    </FullScreenFlow>
  );
}

export function EveFlow({ children, onClose }: { children?: ReactNode; onClose: () => void }) {
  return (
    <FullScreenFlow
      description="Focused assistant conversation."
      onClose={onClose}
      title="Assistant"
    >
      {/* No inset here: the panel renders full-bleed inside this flow and owns
          its own gutter and safe-area padding, so a card-in-a-sheet under two
          stacked titles is no longer what a phone user sees. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children ?? (
          <div className="px-gutter py-4">
            <MobileFailureState kind="assistant" />
          </div>
        )}
      </div>
    </FullScreenFlow>
  );
}

export function MenuFlow({
  onClose,
  onNavigate,
  viewerStandings = NO_VIEWER_STANDINGS_RESOLVED,
}: {
  onClose: () => void;
  onNavigate: () => void;
  viewerStandings?: Promise<ViewerStandings>;
}) {
  return (
    <FullScreenFlow description="Go to another part of Tendnote." onClose={onClose} title="Menu">
      {/* The destinations everyone has render immediately; only a conditional
          one waits, so opening Menu never stalls on a membership read. */}
      <Suspense fallback={<MenuDestinations onNavigate={onNavigate} />}>
        <ViewerMenuDestinations onNavigate={onNavigate} standings={viewerStandings} />
      </Suspense>
      <div className="mt-2 flex flex-col gap-2 border-t px-gutter py-4">
        <p className="text-base" id="mobile-appearance-label">
          Appearance
        </p>
        <ThemeSegmentedControl aria-labelledby="mobile-appearance-label" />
      </div>
    </FullScreenFlow>
  );
}

function ViewerMenuDestinations({
  onNavigate,
  standings,
}: {
  onNavigate: () => void;
  standings: Promise<ViewerStandings>;
}) {
  return (
    <MenuDestinations householdMember={use(standings).householdMember} onNavigate={onNavigate} />
  );
}

function MenuDestinations({
  householdMember = false,
  onNavigate,
}: {
  householdMember?: boolean;
  onNavigate: () => void;
}) {
  return (
    <nav aria-label="Menu destinations" className="flex flex-col divide-y px-gutter py-4">
      {destinationsInGroup("menu", { householdMember }).map((item) => {
        const Icon = item.icon;
        return (
          <Link
            className="flex min-h-14 items-center gap-3 text-base focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={item.route}
            key={item.id}
            /* The destination renders under this overlay, so the overlay has
               to go on activation - otherwise the app reads as frozen while
               the page it hides has already changed. Same contract Search
               uses when a result row is opened. */
            onClick={onNavigate}
          >
            <Icon aria-hidden className="size-5 text-muted-foreground" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
