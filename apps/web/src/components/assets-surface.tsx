"use client";

import type { AssetKind, PrivacyScope } from "@tendnote/domain";
import { ASSET_KIND_OPTIONS } from "@tendnote/domain";
import { visibilityLabelForScope } from "@tendnote/domain/privacy";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CreateAssetForm } from "@/components/asset-create-form";
import { AssetArchivedBadge, AssetKindBadge } from "@/components/asset-shared";
import { ActionScopeChip } from "@/components/general-action-shared";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import type { AssetView } from "@/lib/asset-view";
import { useServerSyncedList } from "@/lib/use-server-synced-list";
import { cn } from "@/lib/utils";

const assetId = (asset: AssetView) => asset.id;

/** The three lifecycle views the surface offers. Active leads; archive is quiet history. */
export type AssetStateFilter = "active" | "archived" | "all";

export type AssetFilters = {
  kind: AssetKind | null;
  state: AssetStateFilter;
  scope: PrivacyScope | null;
};

/**
 * Applies the surface's kind/lifecycle/visibility filters to a loaded list. A
 * pure helper so the render path and tests share one filtering truth — scope
 * *security* filtering already happened server-side; this only narrows what the
 * caller may already see.
 */
export function filterAssets(assets: AssetView[], filters: AssetFilters): AssetView[] {
  return assets.filter(
    (asset) =>
      (filters.kind === null || asset.kind === filters.kind) &&
      (filters.state === "all" || asset.status === filters.state) &&
      (filters.scope === null || asset.scope === filters.scope),
  );
}

/**
 * The Assets surface: a capture-first create form leading the assets the caller
 * can see, with calm chip filters for kind, lifecycle state, and visibility
 * (Phase 6 #197). Rows deep-link into the Asset Profile. Filter groups appear
 * only when they have something to narrow — a single-kind, all-active, all-private
 * list shows no filter chrome at all (DESIGN.md calm-by-default). Every mutation
 * flows through the shared owner-scoped lifecycle via server actions; this
 * component owns the optimistic list state, mirroring ActionsSurface.
 */
export function AssetsSurface({
  assets,
  shareableMembers = [],
}: {
  assets: AssetView[];
  /** Household members an Asset can be shared with; empty keeps the surface private-only. */
  shareableMembers?: ShareableActionMember[];
}) {
  const router = useRouter();
  const [list, setList] = useServerSyncedList(assets, assetId);
  const [filters, setFilters] = useState<AssetFilters>(DEFAULT_ASSET_FILTERS);

  const visible = filterAssets(list, filters);
  const filtered = filters.kind !== null || filters.state !== "active" || filters.scope !== null;

  function addAsset(view: AssetView) {
    setList((current) => [view, ...current.filter((asset) => asset.id !== view.id)]);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <CreateAssetForm onCreate={addAsset} shareableMembers={shareableMembers} />

      <AssetFilterRows filters={filters} list={list} onChange={setFilters} />

      {visible.length ? (
        <LedgerList>
          {visible.map((asset) => (
            <AssetRow asset={asset} key={asset.id} />
          ))}
        </LedgerList>
      ) : (
        <AssetsEmpty filtered={filtered} onClear={() => setFilters(DEFAULT_ASSET_FILTERS)} />
      )}
    </div>
  );
}

/** The untouched-surface view: Active assets of every kind and visibility. */
const DEFAULT_ASSET_FILTERS: AssetFilters = { kind: null, state: "active", scope: null };

/**
 * The surface's calm chip filter rows for kind, lifecycle state, and visibility.
 * Each group appears only when it has something to narrow — a single-kind,
 * all-active, all-private list shows no filter chrome at all (DESIGN.md
 * calm-by-default).
 */
function AssetFilterRows({
  list,
  filters,
  onChange,
}: {
  list: AssetView[];
  filters: AssetFilters;
  onChange: (filters: AssetFilters) => void;
}) {
  // Only offer kind chips that can narrow the *current lifecycle view* — a kind
  // whose only assets are archived must not offer a dead end from the Active
  // view. The currently selected kind always keeps its chip so a selection never
  // becomes invisible (and un-clearable) when a state switch empties it.
  const presentKinds = useMemo(() => {
    const stateVisible = filterAssets(list, { kind: null, state: filters.state, scope: null });
    const kinds = new Set(stateVisible.map((asset) => asset.kind));
    if (filters.kind !== null) {
      kinds.add(filters.kind);
    }
    return ASSET_KIND_OPTIONS.filter((option) => kinds.has(option.kind));
  }, [list, filters.state, filters.kind]);
  const hasArchived = list.some((asset) => asset.archived);
  const hasNonPrivate = list.some((asset) => asset.scope !== "private");

  if (presentKinds.length <= 1 && !hasArchived && !hasNonPrivate) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      {presentKinds.length > 1 ? (
        <FilterChipGroup label="Filter by kind">
          <FilterChip
            onSelect={() => onChange({ ...filters, kind: null })}
            selected={filters.kind === null}
          >
            All kinds
          </FilterChip>
          {presentKinds.map((option) => (
            <FilterChip
              key={option.kind}
              onSelect={() => onChange({ ...filters, kind: option.kind })}
              selected={filters.kind === option.kind}
            >
              {option.label}
            </FilterChip>
          ))}
        </FilterChipGroup>
      ) : null}
      {hasArchived ? <AssetStateFilterRow filters={filters} onChange={onChange} /> : null}
      {hasNonPrivate ? <AssetScopeFilterRow filters={filters} onChange={onChange} /> : null}
    </div>
  );
}

/** Lifecycle chips: Active leads; archive stays one quiet chip away, never hidden. */
function AssetStateFilterRow({
  filters,
  onChange,
}: {
  filters: AssetFilters;
  onChange: (filters: AssetFilters) => void;
}) {
  const options: ReadonlyArray<{ state: AssetStateFilter; label: string }> = [
    { state: "active", label: "Active" },
    { state: "archived", label: "Archived" },
    { state: "all", label: "Everything" },
  ];
  return (
    <FilterChipGroup label="Filter by state">
      {options.map((option) => (
        <FilterChip
          key={option.state}
          onSelect={() => onChange({ ...filters, state: option.state })}
          selected={filters.state === option.state}
        >
          {option.label}
        </FilterChip>
      ))}
    </FilterChipGroup>
  );
}

/** Visibility chips, labeled by the shared scope vocabulary so the words can't drift. */
function AssetScopeFilterRow({
  filters,
  onChange,
}: {
  filters: AssetFilters;
  onChange: (filters: AssetFilters) => void;
}) {
  const options: ReadonlyArray<{ scope: PrivacyScope | null; label: string }> = [
    { scope: null, label: "Any visibility" },
    ...(["private", "shared", "household"] as const).map((scope) => ({
      scope,
      label: visibilityLabelForScope(scope),
    })),
  ];
  return (
    <FilterChipGroup label="Filter by visibility">
      {options.map((option) => (
        <FilterChip
          key={option.label}
          onSelect={() => onChange({ ...filters, scope: option.scope })}
          selected={filters.scope === option.scope}
        >
          {option.label}
        </FilterChip>
      ))}
    </FilterChipGroup>
  );
}

/** The empty ledger: a filtered miss offers a one-click reset; a bare one teaches capture. */
function AssetsEmpty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  if (!filtered) {
    return (
      <LedgerEmpty>
        Nothing tracked yet. Add the first thing you want Tendnote to remember — the fridge, the
        car, a subscription that renews.
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
          <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
            {asset.addedLabel}
          </span>
        </div>
      </div>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}

/**
 * A labeled row of filter chips; the label is visible, quiet, and sentence case.
 * The label is its own flex item with the chips in a nested wrapping container,
 * so wrapped chips stay aligned to the chip column instead of sliding under the
 * label at narrow widths.
 */
function FilterChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toggle-button filter group, not a form fieldset
    <div aria-label={label} className="flex items-start gap-1.5" role="group">
      <span className="min-w-20 shrink-0 pt-1 text-[length:var(--text-caption)] text-muted-foreground">
        {label.replace("Filter by ", "").replace(/^./, (c) => c.toUpperCase())}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * A quiet, keyboard-operable filter pill. Selection is carried by fill *and*
 * `aria-pressed` (never color alone; DESIGN.md §8) — the same vocabulary as the
 * Actions surface Area chips, so filtering reads identically across surfaces.
 */
function FilterChip({
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
