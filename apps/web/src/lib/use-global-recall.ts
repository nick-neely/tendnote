"use client";

import type {
  GlobalRecallFilter,
  GlobalRecallInput,
  GlobalRecallMatchKind,
  GlobalRecallResponse,
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
 * narrowing controls, the same restricted-match gate, the same debounce, the same
 * "two characters before we bother the server" floor. Only the presentation differs,
 * so only the presentation lives in the components.
 *
 * What this hook deliberately does *not* own: where a result goes on activation
 * (each surface routes in its own idiom) and session restoration (the phone flow
 * reopens itself after a browser return; the palette closes and stays closed).
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

export const DEFAULT_GLOBAL_RECALL_FILTERS: GlobalRecallFilters = {
  family: "all",
  matchKind: "all",
  includeArchived: false,
  includeRestricted: false,
};

/** Below this the query is noise, and the server would reject it anyway. */
const MIN_QUERY_LENGTH = 2;
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
  const { failed, failureMessage, loading, response } = useRecallRequest({
    filters,
    query,
    search,
  });

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
    if (meaningfulQuery.length < MIN_QUERY_LENGTH) {
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
