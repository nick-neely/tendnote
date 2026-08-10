"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AssetBrowseControls,
  type AssetFilters,
  assetFilterSearch,
  assetFiltersFromParams,
  assetFiltersNarrow,
  DEFAULT_ASSET_FILTERS,
  filterAssets,
  sameAssetFilters,
} from "@/components/asset-browse-controls";
import { CreateAssetForm } from "@/components/asset-create-form";
import { AssetAttributionLine } from "@/components/asset-household";
import { AssetSearchPanel, type AssetSearchRunner } from "@/components/asset-search-panel";
import { AssetArchivedBadge, AssetKindBadge } from "@/components/asset-shared";
import { ActionScopeChip } from "@/components/general-action-shared";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { ChevronRightIcon } from "@/components/icons";
import { LedgerList } from "@/components/person-ledger";
import { RecordTimingChip } from "@/components/record-timing-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { AssetBrowseRunner, AssetView } from "@/lib/asset-view";
import { useServerSyncedList } from "@/lib/use-server-synced-list";
import { cn } from "@/lib/utils";

const assetId = (asset: AssetView) => asset.id;

/** The three lifecycle views the surface offers. Active leads; archive is quiet history. */
export { filterAssets } from "@/components/asset-browse-controls";

/**
 * The Assets surface: a capture-first create form leading the assets the caller
 * can see, with filters for kind, lifecycle state, visibility, due action, and
 * review status collapsed behind one quiet control (Phase 6 #197/#207). Rows
 * deep-link into the Asset Profile. Every mutation flows through the shared
 * owner-scoped lifecycle via server actions; this component owns the optimistic
 * list state, mirroring ActionsSurface.
 *
 * The URL owns the selection. Filters used to live in `useState` and evaporated on
 * reload, which made a narrowed ledger unshareable and un-bookmarkable; they now
 * round-trip through the query string, with defaults omitted so an unfiltered
 * `/assets` stays bare. State is still applied optimistically first - the URL is
 * written after the list has already repainted, so persistence costs nothing in
 * felt speed.
 */
// fallow-ignore-next-line complexity
export function AssetsSurface({
  assets,
  shareableMembers = [],
  search,
  reviewCount = 0,
  nextOffset = null,
  browse: browseRunner,
}: {
  assets: AssetView[];
  /** Household members an Asset can be shared with; empty keeps the surface private-only. */
  shareableMembers?: ShareableActionMember[];
  /**
   * The unified Asset Search runner (#204). Optional: without it the surface is pure
   * browse, exactly as before — search is additive, never a dependency.
   */
  search?: AssetSearchRunner;
  reviewCount?: number;
  nextOffset?: number | null;
  browse?: AssetBrowseRunner;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlFilters = useMemo(() => assetFiltersFromParams(searchParams), [searchParams]);

  const [list, setList] = useServerSyncedList(assets, assetId);
  const [filters, setFilters] = useState<AssetFilters>(urlFilters);
  const [pageNextOffset, setPageNextOffset] = useState(nextOffset);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The selection the rendered list actually reflects. The server always hands us
  // the default ledger, so that is where this starts, whatever the URL asks for.
  const appliedFilters = useRef(DEFAULT_ASSET_FILTERS);

  useEffect(() => {
    // `nextOffset` describes the server's default ledger. Once a client browse owns
    // the list, that page has its own paging and the prop must not overwrite it.
    if (!sameAssetFilters(appliedFilters.current, DEFAULT_ASSET_FILTERS)) return;
    setPageNextOffset(nextOffset);
  }, [nextOffset]);

  const visible = browseRunner ? list : filterAssets(list, filters);
  const filtered = assetFiltersNarrow(filters);

  function runBrowse(nextFilters: AssetFilters, offset?: number, append = false) {
    if (!browseRunner) return;
    setBrowseError(null);
    startTransition(async () => {
      try {
        const page = await browseRunner({ ...nextFilters, offset });
        setList((current) =>
          append
            ? [
                ...current,
                ...page.assets.filter((asset) => !current.some((row) => row.id === asset.id)),
              ]
            : page.assets,
        );
        setPageNextOffset(page.nextOffset);
      } catch {
        setBrowseError("The asset list couldn't be updated. Try again.");
      }
    });
  }

  /** Brings the list in line with a selection the URL already carries. */
  function applyFilters(nextFilters: AssetFilters) {
    appliedFilters.current = nextFilters;
    setFilters(nextFilters);
    runBrowse(nextFilters);
  }

  /** A deliberate change: repaint first, then record it in the URL. */
  function changeFilters(nextFilters: AssetFilters) {
    applyFilters(nextFilters);
    const query = assetFilterSearch(nextFilters, searchParams.toString());
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Held in a ref so the URL effect below depends on the URL alone: it must replay
  // a selection, never react to an unrelated re-render. Refreshed in its own effect
  // rather than during render - a render can be thrown away or replayed, and this
  // ref is read from a commit.
  const applyFiltersRef = useRef(applyFilters);
  useEffect(() => {
    applyFiltersRef.current = applyFilters;
  });

  useEffect(() => {
    // Mount with a filtered link, and every back/forward step, replay the URL's
    // selection onto the list without writing the URL back.
    if (sameAssetFilters(urlFilters, appliedFilters.current)) return;
    applyFiltersRef.current(urlFilters);
  }, [urlFilters]);

  function addAsset(view: AssetView) {
    setList((current) => [view, ...current.filter((asset) => asset.id !== view.id)]);
    router.refresh();
  }

  // Browsing: the filtered list. While a search query is live this steps aside,
  // because results span memories and evidence — records a browse row cannot represent.
  const browse = (
    <>
      {reviewCount > 0 ? (
        <Link
          className="flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2 text-[length:var(--text-small)] text-accent-soft-foreground transition-colors hover:bg-accent-soft/75 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
          href="/?tab=review"
        >
          <span>{reviewCount === 1 ? "1 asset review" : `${reviewCount} asset reviews`}</span>
          <span aria-hidden>Open review →</span>
        </Link>
      ) : null}
      <AssetBrowseControls
        filters={filters}
        list={list}
        onChange={changeFilters}
        serverBacked={Boolean(browseRunner)}
      />

      {visible.length ? (
        <LedgerList>
          {visible.map((asset) => (
            <AssetRow asset={asset} key={asset.id} members={shareableMembers} />
          ))}
        </LedgerList>
      ) : (
        <AssetsEmpty filtered={filtered} onClear={() => changeFilters(DEFAULT_ASSET_FILTERS)} />
      )}
      {browseError ? <p className="text-sm text-destructive">{browseError}</p> : null}
      {pageNextOffset !== null ? (
        <div className="flex justify-center pt-1">
          <Button
            disabled={pending}
            onClick={() => runBrowse(filters, pageNextOffset, true)}
            type="button"
            variant="outline"
          >
            {pending ? "Loading…" : "Load more assets"}
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <CreateAssetForm onCreate={addAsset} shareableMembers={shareableMembers} />

      {search ? <AssetSearchPanel search={search}>{browse}</AssetSearchPanel> : browse}
    </div>
  );
}

/**
 * The empty ledger, in the product's shared empty treatment. The two emptinesses
 * are different facts and must not read alike: a filtered miss says the filters
 * are the reason and offers to drop them, while a bare ledger teaches the first
 * capture and offers nothing to undo.
 */
function AssetsEmpty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  if (!filtered) {
    return (
      <EmptyState
        description="Start with the fridge, the car, or a subscription that renews."
        title="Nothing tracked yet"
      />
    );
  }
  return (
    <EmptyState
      action={
        <Button onClick={onClear} size="sm" type="button" variant="outline">
          Clear filters
        </Button>
      }
      title="Nothing matches these filters"
    />
  );
}

/**
 * One asset row: the whole row is the link into the Asset Profile, name first and
 * metadata second (Personal Ledger density — a thing you recall, not a record you
 * manage). Archived rows stay in place with a quiet word, never removed or
 * reddened.
 */
function AssetRow({ asset, members }: { asset: AssetView; members: ShareableActionMember[] }) {
  return (
    <Link
      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      href={`/assets/${asset.id}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "truncate font-medium text-[length:var(--text-title)] leading-[var(--text-title-line)]",
              asset.archived && "text-muted-foreground",
            )}
          >
            {asset.name}
          </span>
          {asset.archived ? <AssetArchivedBadge /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <AssetKindBadge kind={asset.kind} label={asset.kindLabel} />
          <ActionScopeChip label={asset.visibilityLabel} scope={asset.scope} />
          {/* Whose it is, in the metadata line rather than beside the name: it
              is context for the row, not part of what the thing is called. */}
          <AssetAttributionLine asset={asset} members={members} />
          {asset.needsReview ? (
            <Badge className="bg-accent-soft text-accent-soft-foreground" variant="secondary">
              Needs review
            </Badge>
          ) : null}
          {asset.nextDueActionLabel && asset.nextDueActionState ? (
            <RecordTimingChip label={asset.nextDueActionLabel} state={asset.nextDueActionState} />
          ) : null}
          <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
            {asset.addedLabel}
          </span>
        </div>
      </div>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}
