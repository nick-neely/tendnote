"use client";

import { assetLabelForKind } from "@tendnote/domain";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AssetKindBadge } from "@/components/asset-shared";
import { LedgerEmpty } from "@/components/person-ledger";
import {
  ASSET_MATCH_KIND_LABEL,
  ASSET_TRUST_LABEL,
  type AssetSearchResultView,
} from "@/lib/asset-search-view";
import { cn } from "@/lib/utils";

/** How long the field waits after the last keystroke before it searches. */
const SEARCH_DEBOUNCE_MS = 250;

export type AssetSearchRunner = (input: {
  query: string;
}) => Promise<{ results: AssetSearchResultView[] }>;

/**
 * One Asset Search experience (#196 user story 51). The user types a serial number, a
 * price, a date, or a half-remembered phrase into the same box; exact, structured, and
 * fuzzy recall run together and the results come back as grounded records.
 *
 * Three decisions carry the design:
 *
 * 1. **The exact value gets its own line, in a mono face.** A filter size or part
 *    number is the answer, not a detail — the user must be able to read it at a glance
 *    without picking it out of prose.
 * 2. **Every row says why it matched.** A fused search that hides its signals feels
 *    like a guess. "Exact value" and "Related" are very different claims, so the row
 *    makes the difference legible.
 * 3. **Searching is a mode, not a filter.** While a query is live the browse list steps
 *    aside entirely, because results span memories and evidence — things the browse
 *    list cannot represent. Clearing the box restores browsing exactly as it was.
 */
export function AssetSearchPanel({
  search,
  children,
}: {
  search: AssetSearchRunner;
  /** The browse list, shown whenever no query is active. */
  children: React.ReactNode;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetSearchResultView[]>([]);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Guards against a slow earlier request overwriting a newer one's results.
  const requestRef = useRef(0);

  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  useEffect(() => {
    if (!searching) {
      setResults([]);
      setSearched(false);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await search({ query: trimmed });
        // A stale response never wins: only the newest request may paint.
        if (requestRef.current !== requestId) {
          return;
        }
        setResults(found.results);
        setSearched(true);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search, searching, trimmed]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          aria-label="Search your things"
          className={cn(
            "h-10 w-full rounded-md border border-input bg-background pl-9 text-sm",
            "pr-3 outline-none transition-colors placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          )}
          id={inputId}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a serial, model, price, date, or just describe it…"
          type="search"
          value={query}
        />
      </div>

      {searching ? (
        <AssetSearchResults
          isPending={isPending}
          query={trimmed}
          results={results}
          searched={searched}
        />
      ) : (
        children
      )}
    </div>
  );
}

function AssetSearchResults({
  results,
  query,
  isPending,
  searched,
}: {
  results: AssetSearchResultView[];
  query: string;
  isPending: boolean;
  searched: boolean;
}) {
  // Nothing has come back yet: stay quiet rather than flashing an empty state that
  // would read as "no matches" before a match has even been looked for.
  if (!searched && isPending) {
    return <p className="py-6 text-center text-muted-foreground text-sm">Searching…</p>;
  }

  if (results.length === 0) {
    return (
      <LedgerEmpty>
        Nothing matches "{query}". Try a serial or model number, an exact price or date, or describe
        the thing in your own words.
      </LedgerEmpty>
    );
  }

  return (
    <ul
      aria-busy={isPending}
      className="flex flex-col divide-y divide-border"
      data-testid="asset-search-results"
    >
      {results.map((result) => (
        <li key={result.key}>
          <AssetSearchRow result={result} />
        </li>
      ))}
    </ul>
  );
}

function AssetSearchRow({ result }: { result: AssetSearchResultView }) {
  return (
    <Link
      className="flex flex-col gap-1.5 py-3 transition-colors hover:bg-muted/40"
      href={`/assets/${result.assetId}`}
      prefetch={false}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-sm">{result.assetName}</span>
        <AssetKindBadge kind={result.assetKind} label={assetLabelForKind(result.assetKind)} />
        {result.archived ? <span className="text-muted-foreground text-xs">Archived</span> : null}
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-xs">{result.label}</span>
        {result.value ? (
          // The answer. Mono + tabular so a part number or price reads exactly.
          <span className="font-mono text-sm tabular-nums">{result.value}</span>
        ) : (
          <span className="text-sm">{result.snippet}</span>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        {ASSET_TRUST_LABEL[result.trustLevel]}
        {" · "}
        {result.matchKinds.map((kind) => ASSET_MATCH_KIND_LABEL[kind]).join(" + ")}
        {" · "}
        {result.visibilityLabel}
      </p>
    </Link>
  );
}
