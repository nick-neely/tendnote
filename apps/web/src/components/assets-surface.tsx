"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  AssetBrowseControls,
  type AssetFilters,
  DEFAULT_ASSET_FILTERS,
  filterAssets,
} from "@/components/asset-browse-controls";
import { CreateAssetForm } from "@/components/asset-create-form";
import { AssetSearchPanel, type AssetSearchRunner } from "@/components/asset-search-panel";
import { AssetArchivedBadge, AssetKindBadge } from "@/components/asset-shared";
import { ActionScopeChip } from "@/components/general-action-shared";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { ChevronRightIcon } from "@/components/icons";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { RecordTimingChip } from "@/components/record-timing-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssetBrowseRunner, AssetView } from "@/lib/asset-view";
import { useServerSyncedList } from "@/lib/use-server-synced-list";
import { cn } from "@/lib/utils";

const assetId = (asset: AssetView) => asset.id;

/** The three lifecycle views the surface offers. Active leads; archive is quiet history. */
export { filterAssets } from "@/components/asset-browse-controls";

/**
 * The Assets surface: a capture-first create form leading the assets the caller
 * can see, with calm chip filters for kind, lifecycle state, and visibility
 * (Phase 6 #197/#207). Rows deep-link into the Asset Profile. Filter groups appear
 * only when they have something to narrow — a single-kind, all-active, all-private
 * list shows no filter chrome at all (DESIGN.md calm-by-default). Every mutation
 * flows through the shared owner-scoped lifecycle via server actions; this
 * component owns the optimistic list state, mirroring ActionsSurface.
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
  const [list, setList] = useServerSyncedList(assets, assetId);
  const [filters, setFilters] = useState<AssetFilters>(DEFAULT_ASSET_FILTERS);
  const [pageNextOffset, setPageNextOffset] = useState(nextOffset);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setPageNextOffset(nextOffset), [nextOffset]);

  const visible = browseRunner ? list : filterAssets(list, filters);
  const filtered =
    filters.kind !== null ||
    filters.state !== "active" ||
    filters.scope !== null ||
    filters.due !== null ||
    filters.review !== null;

  function requestPage(nextFilters: AssetFilters, offset?: number, append = false) {
    setFilters(nextFilters);
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

  function addAsset(view: AssetView) {
    setList((current) => [view, ...current.filter((asset) => asset.id !== view.id)]);
    router.refresh();
  }

  // Browsing: the chip-filtered list. While a search query is live this steps aside,
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
        filtered={filtered}
        filters={filters}
        list={list}
        onChange={requestPage}
        serverBacked={Boolean(browseRunner)}
      />

      {visible.length ? (
        <LedgerList>
          {visible.map((asset) => (
            <AssetRow asset={asset} key={asset.id} />
          ))}
        </LedgerList>
      ) : (
        <AssetsEmpty filtered={filtered} onClear={() => requestPage(DEFAULT_ASSET_FILTERS)} />
      )}
      {browseError ? <p className="text-sm text-destructive">{browseError}</p> : null}
      {pageNextOffset !== null ? (
        <div className="flex justify-center pt-1">
          <Button
            disabled={pending}
            onClick={() => requestPage(filters, pageNextOffset, true)}
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

/** The empty ledger: a filtered miss offers a one-click reset; a bare one teaches capture. */
function AssetsEmpty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  if (!filtered) {
    return (
      <LedgerEmpty>
        Nothing tracked yet. Start with the fridge, the car, or a subscription that renews.
      </LedgerEmpty>
    );
  }
  return (
    <LedgerEmpty>
      Nothing matches these filters.{" "}
      <button
        className="rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onClear}
        type="button"
      >
        Show everything active
      </button>
      .
    </LedgerEmpty>
  );
}

/**
 * One asset row: the whole row is the link into the Asset Profile, name first and
 * metadata second (Personal Ledger density — a thing you recall, not a record you
 * manage). Archived rows stay in place with a quiet word, never removed or
 * reddened.
 */
function AssetRow({ asset }: { asset: AssetView }) {
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
