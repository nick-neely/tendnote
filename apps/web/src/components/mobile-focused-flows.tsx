"use client";

import type {
  GlobalRecallFilter,
  GlobalRecallInput,
  GlobalRecallMatchKind,
  GlobalRecallResponse,
} from "@tendnote/domain/global-recall";
import Link from "next/link";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { destinationsInGroup } from "@/components/app-destinations";
import { ArrowLeftIcon, SearchIcon } from "@/components/icons";
import { type CaptureHandlers, MobileCaptureFlow } from "@/components/mobile-capture-flow";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { ThemeSegmentedControl } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type OwnerActionResult,
  ownerActionFailureMessage,
  unwrapOwnerActionResult,
} from "@/lib/owner-action-result";

export type FocusedFlow = "search" | "capture" | "menu";

export type { CaptureHandlers } from "@/components/mobile-capture-flow";
export type GlobalRecallHandler = (
  input: GlobalRecallInput,
) => Promise<OwnerActionResult<GlobalRecallResponse>>;

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
        <header className="flex min-h-14 items-center gap-2 border-b px-3 pt-[env(safe-area-inset-top)]">
          <Button
            aria-label="Close"
            className="size-11"
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
  const [family, setFamily] = useState<GlobalRecallFilter>("all");
  const [matchKind, setMatchKind] = useState<GlobalRecallMatchKind | "all">("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const storageKey = `tendnote:global-recall:${ownerUserId}`;
  useRestoreRecallState({
    restoredFocusRef,
    restoredScrollRef,
    setExpanded,
    setFamily,
    setIncludeArchived,
    setIncludeRestricted,
    setMatchKind,
    setQuery,
    storageKey,
  });
  const { failed, failureMessage, loading, response } = useRecallRequest({
    family,
    includeArchived,
    includeRestricted,
    matchKind,
    query,
    search,
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
      window.history.replaceState(
        {
          ...window.history.state,
          tendnoteGlobalRecallOwner: ownerUserId,
          tendnoteGlobalRecallReturnUrl: window.location.href,
        },
        "",
        window.location.href,
      );
    }
  }

  function toggleExplanation(key: string) {
    setExpanded((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  const { exact, related } = partitionRecallResults(response);
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
      <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
        <RecallSearchControls
          family={family}
          includeArchived={includeArchived}
          includeRestricted={includeRestricted}
          inputRef={inputRef}
          matchKind={matchKind}
          query={query}
          setFamily={setFamily}
          setIncludeArchived={setIncludeArchived}
          setIncludeRestricted={setIncludeRestricted}
          setMatchKind={setMatchKind}
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

type StoredRecallState = {
  query?: string;
  family?: GlobalRecallFilter;
  matchKind?: GlobalRecallMatchKind | "all";
  includeArchived?: boolean;
  includeRestricted?: boolean;
  expanded?: string[];
  focusedKey?: string;
  restoreFocus?: boolean;
  scrollTop?: number;
};

function useRestoreRecallState(input: {
  storageKey: string;
  setQuery: (value: string) => void;
  setFamily: (value: GlobalRecallFilter) => void;
  setMatchKind: (value: GlobalRecallMatchKind | "all") => void;
  setIncludeArchived: (value: boolean) => void;
  setIncludeRestricted: (value: boolean) => void;
  setExpanded: (value: string[]) => void;
  restoredScrollRef: RefObject<number | null>;
  restoredFocusRef: RefObject<string | null>;
}) {
  const {
    restoredFocusRef,
    restoredScrollRef,
    setExpanded,
    setFamily,
    setIncludeArchived,
    setIncludeRestricted,
    setMatchKind,
    setQuery,
    storageKey,
  } = input;
  useEffect(() => {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as StoredRecallState;
      if (saved.query) setQuery(saved.query);
      if (saved.family) setFamily(saved.family);
      if (saved.matchKind) setMatchKind(saved.matchKind);
      setIncludeArchived(saved.includeArchived ?? false);
      setIncludeRestricted(saved.family !== "all" && (saved.includeRestricted ?? false));
      setExpanded(saved.expanded ?? []);
      restoredScrollRef.current = saved.scrollTop ?? 0;
      restoredFocusRef.current = saved.restoreFocus ? (saved.focusedKey ?? null) : null;
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }, [
    restoredFocusRef,
    restoredScrollRef,
    setExpanded,
    setFamily,
    setIncludeArchived,
    setIncludeRestricted,
    setMatchKind,
    setQuery,
    storageKey,
  ]);
}

function useRecallRequest(input: {
  family: GlobalRecallFilter;
  includeArchived: boolean;
  includeRestricted: boolean;
  matchKind: GlobalRecallMatchKind | "all";
  query: string;
  search: GlobalRecallHandler;
}) {
  const { family, includeArchived, includeRestricted, matchKind, query, search } = input;
  const [response, setResponse] = useState<GlobalRecallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  useEffect(() => {
    const meaningfulQuery = query.trim();
    if (meaningfulQuery.length < 2) {
      setResponse(null);
      setFailed(false);
      setFailureMessage(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    setFailureMessage(null);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const next = unwrapOwnerActionResult(
          await search({
            query: meaningfulQuery,
            family,
            includeArchived,
            includeRestricted,
            ...(matchKind === "all" ? {} : { matchKinds: [matchKind] }),
          }),
        );
        if (!controller.signal.aborted) setResponse(next);
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailed(true);
          setFailureMessage(ownerActionFailureMessage(error));
          setResponse(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [family, includeArchived, includeRestricted, matchKind, query, search]);
  return { failed, failureMessage, loading, response };
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

function partitionRecallResults(response: GlobalRecallResponse | null) {
  const results = response?.results ?? [];
  return {
    exact: results.filter((result) => result.match.kind === "exact"),
    related: results.filter((result) => result.match.kind === "related"),
  };
}

function RecallSearchControls({
  family,
  includeArchived,
  includeRestricted,
  inputRef,
  matchKind,
  query,
  setFamily,
  setIncludeArchived,
  setIncludeRestricted,
  setMatchKind,
  setQuery,
}: {
  family: GlobalRecallFilter;
  includeArchived: boolean;
  includeRestricted: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  matchKind: GlobalRecallMatchKind | "all";
  query: string;
  setFamily: (value: GlobalRecallFilter) => void;
  setIncludeArchived: (value: boolean) => void;
  setIncludeRestricted: (value: boolean) => void;
  setMatchKind: (value: GlobalRecallMatchKind | "all") => void;
  setQuery: (value: string) => void;
}) {
  function selectFamily(value: GlobalRecallFilter) {
    setFamily(value);
    if (value === "all") setIncludeRestricted(false);
  }

  const restrictedLocked = family === "all";
  return (
    <>
      <label className="sr-only" htmlFor="mobile-global-search">
        Search Tendnote
      </label>
      <div className="flex min-h-12 items-center gap-2 rounded-xl border px-3 focus-within:ring-3 focus-within:ring-ring/35">
        <SearchIcon aria-hidden className="size-4 text-muted-foreground" />
        <input
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          id="mobile-global-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people, actions, assets…"
          ref={inputRef}
          value={query}
        />
      </div>
      {/* The four narrowing controls read as one quiet panel under the field
          rather than four loose controls scattered across the canvas: labelled
          selects on top, the two switches beneath them, all inside one block. */}
      <div className="mt-3 flex flex-col gap-3 rounded-xl border bg-panel p-3">
        {/* `basis-36` is rem-based, so the pair sits side by side at normal text
            and folds to one per row once the owner turns the type up - the point
            where two columns start truncating their own values. */}
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-0 flex-1 basis-36 flex-col gap-1.5">
            <Label htmlFor="global-recall-family">Record type</Label>
            <Select
              onValueChange={(value) => selectFamily(value as GlobalRecallFilter)}
              value={family}
            >
              <SelectTrigger className="min-h-11 w-full bg-background" id="global-recall-family">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All records</SelectItem>
                <SelectItem value="people">People</SelectItem>
                <SelectItem value="follow_ups">Follow-Ups</SelectItem>
                <SelectItem value="actions">Actions</SelectItem>
                <SelectItem value="assets">Assets</SelectItem>
                <SelectItem value="saved_items">Saved Items</SelectItem>
                <SelectItem value="calendar">Calendar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-1 basis-36 flex-col gap-1.5">
            <Label htmlFor="global-recall-match">Match</Label>
            <Select
              onValueChange={(value) => setMatchKind(value as GlobalRecallMatchKind | "all")}
              value={matchKind}
            >
              <SelectTrigger className="min-h-11 w-full bg-background" id="global-recall-match">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Exact + Related</SelectItem>
                <SelectItem value="exact">Exact only</SelectItem>
                <SelectItem value="related">Related only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              checked={includeArchived}
              id="global-recall-archived"
              onCheckedChange={(checked) => setIncludeArchived(checked === true)}
            />
            <Label className="min-h-11 flex-1 font-normal" htmlFor="global-recall-archived">
              Include archived
            </Label>
          </div>
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              aria-describedby={restrictedLocked ? "global-recall-restricted-hint" : undefined}
              checked={includeRestricted}
              disabled={restrictedLocked}
              id="global-recall-restricted"
              onCheckedChange={(checked) => setIncludeRestricted(checked === true)}
            />
            {/* The label stays the name of the control. What is standing in the
                way belongs in helper text, not in the label - a label that
                changes into an instruction reads as a broken control. */}
            <Label className="min-h-11 flex-1 font-normal" htmlFor="global-recall-restricted">
              Reveal restricted matches
            </Label>
          </div>
          {restrictedLocked ? (
            <p
              className="pl-7 text-[length:var(--text-small)] text-muted-foreground"
              id="global-recall-restricted-hint"
            >
              Pick a record type first.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
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
      {/* The surface below the filters used to be ~640px of nothing until the
          second keystroke. It now says what is searchable, then what came back. */}
      {!loading && !failed && !response ? (
        <EmptyState
          className="mt-4"
          description="Type a name or a few words. Tendnote looks across your people, memories, follow-ups, and assets."
          title="Search your notebook"
        />
      ) : null}
      {!loading && response && response.results.length === 0 ? (
        <EmptyState
          className="mt-4"
          description="Try different wording, or widen the filters above."
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
          return (
            <article className="py-3" key={key}>
              <Link
                className="block min-h-11 rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                href={result.href}
                id={resultElementId(key)}
                onClick={() => onNavigate(key)}
              >
                <span className="block font-medium text-sm">{result.label}</span>
                <span className="mt-1 line-clamp-2 block text-muted-foreground text-sm">
                  {result.supportingText}
                </span>
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
    <FullScreenFlow description="Focused Eve conversation." onClose={onClose} title="Eve">
      <div className="min-h-0 flex-1 overflow-hidden p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {children ?? <MobileFailureState kind="eve" />}
      </div>
    </FullScreenFlow>
  );
}

export function MenuFlow({ onClose, onNavigate }: { onClose: () => void; onNavigate: () => void }) {
  return (
    <FullScreenFlow description="Go to another part of Tendnote." onClose={onClose} title="Menu">
      <nav aria-label="Menu destinations" className="flex flex-col divide-y px-5 py-4">
        {destinationsInGroup("menu").map((item) => {
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
      <div className="mt-2 flex flex-col gap-2 border-t px-5 py-4">
        <p className="text-base" id="mobile-appearance-label">
          Appearance
        </p>
        <ThemeSegmentedControl aria-labelledby="mobile-appearance-label" />
      </div>
    </FullScreenFlow>
  );
}
