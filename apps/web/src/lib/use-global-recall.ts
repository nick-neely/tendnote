"use client";

import {
  type GlobalRecallFilter,
  type GlobalRecallInput,
  type GlobalRecallMatchKind,
  type GlobalRecallResponse,
  isMeaningfulRecallQuery,
} from "@tendnote/domain/global-recall";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type OwnerActionResult,
  ownerActionFailureMessage,
  unwrapOwnerActionResult,
} from "@/lib/owner-action-result";

/**
 * The one client-side Global Recall search, shared by every surface that offers it.
 *
 * Recall has two front doors - the phone's full-screen Search flow and the desktop
 * command palette - and they must ask the same question of the same seam: the same
 * narrowing controls, the same restricted-match gate, the same debounce, and the
 * seam's own floor on what counts as a query worth sending. Only the presentation
 * differs, so only the presentation lives in the components.
 *
 * What this hook deliberately does *not* own: where a result goes on activation
 * (each surface routes in its own idiom) or how its presentation restores after a
 * browser return. The phone flow and desktop palette each persist their own focus
 * and filter shape around that shared response seam.
 */

export type GlobalRecallHandler = (
  input: GlobalRecallInput,
) => Promise<OwnerActionResult<GlobalRecallResponse>>;

/** The four narrowing controls, as one value. */
export type GlobalRecallFilters = {
  family: GlobalRecallFilter;
  /** `"all"` means both kinds - the input schema omits `matchKinds` entirely. */
  matchKind: GlobalRecallMatchKind | "all";
  includeArchived: boolean;
  includeRestricted: boolean;
};

const DEFAULT_GLOBAL_RECALL_FILTERS: GlobalRecallFilters = {
  family: "all",
  matchKind: "all",
  includeArchived: false,
  includeRestricted: false,
};

/**
 * What the two narrowing selects offer, shared for the same reason the search
 * itself is: the phone flow and the desktop palette must not drift into naming
 * different records or different match strengths.
 *
 * Only the options are shared. The two surfaces lay their controls out
 * differently on purpose - thumb-sized rows in a panel against a compact bar
 * under a command list - so the markup stays with each of them.
 */
export const GLOBAL_RECALL_FAMILY_OPTIONS: {
  value: GlobalRecallFilter;
  label: string;
}[] = [
  { value: "all", label: "All records" },
  { value: "people", label: "People" },
  { value: "follow_ups", label: "Follow-Ups" },
  { value: "actions", label: "Actions" },
  { value: "assets", label: "Assets" },
  { value: "saved_items", label: "Saved Items" },
  { value: "calendar", label: "Calendar" },
  { value: "self_context", label: "Self Context" },
];

export const GLOBAL_RECALL_MATCH_OPTIONS: {
  value: GlobalRecallMatchKind | "all";
  label: string;
}[] = [
  { value: "all", label: "Exact + Related" },
  { value: "exact", label: "Exact only" },
  { value: "related", label: "Related only" },
];

/** Long enough that typing a name is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;

export type GlobalRecallSearch = {
  filters: GlobalRecallFilters;
  /** Picking a family also un-gates restricted matches; leaving it re-locks them. */
  setFamily: (value: GlobalRecallFilter) => void;
  setMatchKind: (value: GlobalRecallMatchKind | "all") => void;
  setIncludeArchived: (value: boolean) => void;
  setIncludeRestricted: (value: boolean) => void;
  /** Re-applies saved filters (a restored session) under the same gate. */
  restoreFilters: (saved: Partial<GlobalRecallFilters>) => void;
  /** Restricted matches need one named family to reveal, never "all records". */
  restrictedLocked: boolean;
  /**
   * Whether the current query is one recall will actually run. A surface needs
   * this to tell "not a search yet" from "a search that found nothing" - both
   * leave `response` null and nothing loading, and only one of them is an
   * answer.
   */
  searchable: boolean;
  loading: boolean;
  failed: boolean;
  failureMessage: string | null;
  response: GlobalRecallResponse | null;
  exact: GlobalRecallResponse["results"];
  related: GlobalRecallResponse["results"];
};

export function useGlobalRecall({
  query,
  search,
}: {
  query: string;
  search: GlobalRecallHandler;
}): GlobalRecallSearch {
  const [filters, setFilters] = useState<GlobalRecallFilters>(DEFAULT_GLOBAL_RECALL_FILTERS);
  const {
    failed,
    failureMessage,
    loading,
    response: fetched,
  } = useRecallRequest({
    filters,
    query,
    search,
  });

  /**
   * Un-checking "Reveal restricted matches" narrows a privacy boundary, and the
   * replacement search is a debounce plus a round trip away. The server remains
   * the gate - it decides whether restricted records are retrieved at all - but
   * until its answer lands, the rows on screen are the ones the owner has just
   * asked to stop seeing, so they are withheld here too rather than staying
   * readable and selectable for the length of the request.
   */
  const response = useMemo(() => {
    if (!fetched || filters.includeRestricted) return fetched;
    const permitted = fetched.results.filter((result) => result.sensitivity !== "restricted");
    return permitted.length === fetched.results.length
      ? fetched
      : { ...fetched, results: permitted };
  }, [fetched, filters.includeRestricted]);

  const setFamily = useCallback((family: GlobalRecallFilter) => {
    setFilters((current) => ({
      ...current,
      family,
      // Widening back to every record puts restricted matches out of reach again;
      // leaving the box checked would misreport what the next search covers.
      includeRestricted: family === "all" ? false : current.includeRestricted,
    }));
  }, []);
  const setMatchKind = useCallback((matchKind: GlobalRecallMatchKind | "all") => {
    setFilters((current) => ({ ...current, matchKind }));
  }, []);
  const setIncludeArchived = useCallback((includeArchived: boolean) => {
    setFilters((current) => ({ ...current, includeArchived }));
  }, []);
  const setIncludeRestricted = useCallback((includeRestricted: boolean) => {
    setFilters((current) => ({ ...current, includeRestricted }));
  }, []);
  const restoreFilters = useCallback((saved: Partial<GlobalRecallFilters>) => {
    setFilters((current) => {
      const family = saved.family ?? current.family;
      return {
        family,
        matchKind: saved.matchKind ?? current.matchKind,
        includeArchived: saved.includeArchived ?? false,
        // The gate is re-checked against the family being restored, so a stored
        // pair the schema would reject (restricted + "all") can never come back.
        includeRestricted: family !== "all" && (saved.includeRestricted ?? false),
      };
    });
  }, []);

  const results = response?.results;
  const exact = useMemo(
    () => (results ?? []).filter((result) => result.match.kind === "exact"),
    [results],
  );
  const related = useMemo(
    () => (results ?? []).filter((result) => result.match.kind === "related"),
    [results],
  );

  return {
    exact,
    failed,
    failureMessage,
    filters,
    loading,
    related,
    response,
    restoreFilters,
    restrictedLocked: filters.family === "all",
    searchable: isMeaningfulRecallQuery(query),
    setFamily,
    setIncludeArchived,
    setIncludeRestricted,
    setMatchKind,
  };
}

function useRecallRequest({
  filters,
  query,
  search,
}: {
  filters: GlobalRecallFilters;
  query: string;
  search: GlobalRecallHandler;
}) {
  const { family, includeArchived, includeRestricted, matchKind } = filters;
  const [response, setResponse] = useState<GlobalRecallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  useEffect(() => {
    const meaningfulQuery = query.trim();
    // The seam's own floor, not an approximation of it: a query it would reject
    // is one we never send, so "not a search yet" can never surface as "your
    // search failed".
    if (!isMeaningfulRecallQuery(meaningfulQuery)) {
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
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [family, includeArchived, includeRestricted, matchKind, query, search]);
  return { failed, failureMessage, loading, response };
}
