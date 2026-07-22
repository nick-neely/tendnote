"use client";

import { assetLabelForKind } from "@tendnote/domain";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { AssetKindBadge } from "@/components/asset-shared";
import { LedgerEmpty } from "@/components/person-ledger";
import { Button } from "@/components/ui/button";
import {
  ASSET_TRUST_LABEL,
  type AssetSearchResultView,
  isExactAssetSearchResult,
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
 * Four decisions carry the design:
 *
 * 1. **The exact value gets its own line, in a mono face.** A filter size or part
 *    number is the answer, not a detail — the user must be able to read it at a glance
 *    without picking it out of prose.
 * 2. **Exact and fuzzy are different kinds of claim, so they are different groups.**
 *    "This record contains what you typed" and "this seemed related to what you meant"
 *    cannot share one undifferentiated list: the strongest thing this search can say
 *    would be reduced to a word in a metadata run-on. The heading carries the signal,
 *    and a structured hit — the value literally *is* what you typed — is marked at the
 *    value itself, where the claim lives.
 * 3. **A failed query is an inline result, not a dead page.** Search is the one control
 *    on this surface that runs a query per keystroke; it must never take the Assets page
 *    down with it.
 * 4. **Searching is a mode, not a filter.** While a query is live the browse list steps
 *    aside entirely, because results span memories and evidence — things the browse list
 *    cannot represent. Clearing the box restores browsing exactly as it was.
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
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Guards against a slow earlier request overwriting a newer one's results.
  const requestRef = useRef(0);

  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  const run = useCallback(
    (term: string) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;

      startTransition(async () => {
        try {
          const found = await search({ query: term });
          // A stale response never wins: only the newest request may paint.
          if (requestRef.current !== requestId) {
            return;
          }
          setResults(found.results);
          setSearched(true);
          setFailed(false);
        } catch {
          if (requestRef.current !== requestId) {
            return;
          }
          // The query failed; the page did not. Say so in the results slot and leave
          // everything else — the field, the browse list behind it — exactly as it was.
          setResults([]);
          setSearched(true);
          setFailed(true);
        }
      });
    },
    [search],
  );

  useEffect(() => {
    if (!searching) {
      setResults([]);
      setSearched(false);
      setFailed(false);
      return;
    }

    const timer = setTimeout(() => run(trimmed), SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [run, searching, trimmed]);

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
          failed={failed}
          isPending={isPending}
          // Retry runs the same query again — a debounce only fires on *change*, so
          // without this the user would have to edit text they already typed correctly.
          onRetry={() => run(trimmed)}
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
  failed,
  onRetry,
}: {
  results: AssetSearchResultView[];
  query: string;
  isPending: boolean;
  searched: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  // Nothing has come back yet: stay quiet rather than flashing an empty state that
  // would read as "no matches" before a match has even been looked for.
  if (!searched && isPending) {
    return <p className="py-6 text-center text-muted-foreground text-sm">Searching…</p>;
  }

  if (failed) {
    return <SearchFailed isPending={isPending} onRetry={onRetry} />;
  }

  if (results.length === 0) {
    return <LedgerEmpty>Nothing matches "{query}".</LedgerEmpty>;
  }

  const exact = results.filter(isExactAssetSearchResult);
  const related = results.filter((result) => !isExactAssetSearchResult(result));

  return (
    <div aria-busy={isPending} className="flex flex-col gap-6" data-testid="asset-search-results">
      {exact.length > 0 ? (
        <AssetSearchGroup
          hint="These records contain exactly what you typed."
          results={exact}
          title="Exact matches"
        />
      ) : null}
      {related.length > 0 ? (
        <AssetSearchGroup
          // True in both cases the fusion can produce: facts about a thing you *did*
          // find that simply use different words, and — when nothing matched exactly —
          // the meaning-only fallback. Neither is a claim that your words appear here.
          hint="Matched by meaning, not by the words you typed."
          results={related}
          title="Related"
        />
      ) : null}
    </div>
  );
}

/**
 * A failed query, stated plainly and recoverably. It replaces the results and nothing
 * else: the query is still in the box, the browse list is still one keystroke away, and
 * the page never goes down over a search.
 */
function SearchFailed({ isPending, onRetry }: { isPending: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <p
        className="max-w-[52ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
        role="alert"
      >
        That search didn't run. Nothing is wrong with your things.
      </p>
      <Button disabled={isPending} onClick={onRetry} size="sm" type="button" variant="outline">
        Try again
      </Button>
    </div>
  );
}

/**
 * One band of results under the claim they all share. The heading is the honest label
 * for the whole group, so an individual row never has to carry the word "Related" in a
 * caption run-on to be understood.
 */
function AssetSearchGroup({
  title,
  hint,
  results,
}: {
  title: string;
  hint: string;
  results: AssetSearchResultView[];
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium text-[length:var(--text-caption)]">{title}</h3>
        <p className="text-[length:var(--text-caption)] text-muted-foreground">{hint}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {results.map((result) => (
          <li key={result.key}>
            <AssetSearchRow result={result} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AssetSearchRow({ result }: { result: AssetSearchResultView }) {
  // The strongest claim Asset Search can make: not "this text matched", but "the stored
  // value *is* what you typed". It is marked at the value, because that is what it
  // certifies.
  const exactValue = result.matchKinds.includes("structured");

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
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* The answer. Mono + tabular so a part number or price reads exactly. */}
            <span className="font-mono text-sm tabular-nums">{result.value}</span>
            {exactValue ? (
              <span className="inline-flex w-fit items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-primary">
                Exact value
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-sm">{result.snippet}</span>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        {ASSET_TRUST_LABEL[result.trustLevel]}
        {" · "}
        {result.visibilityLabel}
      </p>
    </Link>
  );
}
