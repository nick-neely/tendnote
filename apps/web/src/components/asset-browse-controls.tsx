"use client";

import type { AssetKind, PrivacyScope } from "@tendnote/domain";
import { ASSET_KIND_OPTIONS } from "@tendnote/domain";
import { visibilityLabelForScope } from "@tendnote/domain/privacy";
import { useMemo, useState } from "react";
import type { AssetBrowseRequest, AssetView } from "@/lib/asset-view";
import { cn } from "@/lib/utils";

export type AssetStateFilter = "active" | "archived" | "all";

export type AssetFilters = {
  kind: AssetKind | null;
  state: AssetStateFilter;
  scope: PrivacyScope | null;
  due: AssetBrowseRequest["due"];
  review: AssetBrowseRequest["review"];
  sort: AssetBrowseRequest["sort"];
};

export const DEFAULT_ASSET_FILTERS: AssetFilters = {
  kind: null,
  state: "active",
  scope: null,
  due: null,
  review: null,
  sort: "name",
};

type ClientAssetFilters = Pick<AssetFilters, "kind" | "state" | "scope"> &
  Partial<Pick<AssetFilters, "due" | "review">>;

// fallow-ignore-next-line complexity
function matchesAsset(asset: AssetView, filters: ClientAssetFilters) {
  const dueFilter = filters.due ?? null;
  const reviewFilter = filters.review ?? null;
  return (
    (filters.kind === null || asset.kind === filters.kind) &&
    (filters.state === "all" || asset.status === filters.state) &&
    (filters.scope === null || asset.scope === filters.scope) &&
    (dueFilter === null ||
      (dueFilter === "with_due_action"
        ? asset.nextDueActionLabel != null
        : asset.nextDueActionLabel == null)) &&
    (reviewFilter === null ||
      (reviewFilter === "needs_review" ? asset.needsReview : !asset.needsReview))
  );
}

/** Client-only fallback for stories and tests; production browsing is database-owned. */
export function filterAssets(assets: AssetView[], filters: ClientAssetFilters): AssetView[] {
  return assets.filter((asset) => matchesAsset(asset, filters));
}

export function AssetBrowseControls({
  list,
  filters,
  filtered,
  onChange,
  serverBacked,
}: {
  list: AssetView[];
  filters: AssetFilters;
  filtered: boolean;
  onChange: (filters: AssetFilters) => void;
  serverBacked: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-controls="asset-browse-controls"
        aria-expanded={open}
        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-[length:var(--text-small)] font-medium text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none md:hidden"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>Filters and sort</span>
        <span className="font-normal text-muted-foreground" aria-hidden>
          {filtered ? "Adjusted" : open ? "Hide" : "Show"}
        </span>
      </button>
      <div
        className={cn("flex-col gap-2", open ? "flex" : "hidden md:flex")}
        id="asset-browse-controls"
      >
        <AssetFilterRows
          filters={filters}
          list={list}
          onChange={onChange}
          serverBacked={serverBacked}
        />
        {serverBacked ? <AssetStatusControls filters={filters} onChange={onChange} /> : null}
      </div>
    </>
  );
}

// fallow-ignore-next-line complexity
function AssetFilterRows({
  list,
  filters,
  onChange,
  serverBacked,
}: {
  list: AssetView[];
  filters: AssetFilters;
  onChange: (filters: AssetFilters) => void;
  serverBacked: boolean;
}) {
  const presentKinds = useMemo(() => {
    const stateVisible = filterAssets(list, { ...DEFAULT_ASSET_FILTERS, state: filters.state });
    const kinds = new Set(stateVisible.map((asset) => asset.kind));
    if (filters.kind !== null) kinds.add(filters.kind);
    return serverBacked
      ? ASSET_KIND_OPTIONS
      : ASSET_KIND_OPTIONS.filter((option) => kinds.has(option.kind));
  }, [list, filters.state, filters.kind, serverBacked]);
  const hasArchived = list.some((asset) => asset.archived);
  const hasNonPrivate = list.some((asset) => asset.scope !== "private");

  if (!serverBacked && presentKinds.length <= 1 && !hasArchived && !hasNonPrivate) return null;
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
      {hasArchived || serverBacked ? (
        <AssetStateFilterRow filters={filters} onChange={onChange} />
      ) : null}
      {hasNonPrivate || serverBacked ? (
        <AssetScopeFilterRow filters={filters} onChange={onChange} />
      ) : null}
    </div>
  );
}

function AssetStatusControls({
  filters,
  onChange,
}: {
  filters: AssetFilters;
  onChange: (filters: AssetFilters) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border/70 pt-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2">
        <FilterChipGroup label="Filter by due action">
          <FilterChip onSelect={() => onChange({ ...filters, due: null })} selected={!filters.due}>
            Any timing
          </FilterChip>
          <FilterChip
            onSelect={() => onChange({ ...filters, due: "with_due_action" })}
            selected={filters.due === "with_due_action"}
          >
            Has due action
          </FilterChip>
          <FilterChip
            onSelect={() => onChange({ ...filters, due: "without_due_action" })}
            selected={filters.due === "without_due_action"}
          >
            No due action
          </FilterChip>
        </FilterChipGroup>
        <FilterChipGroup label="Filter by review status">
          <FilterChip
            onSelect={() => onChange({ ...filters, review: null })}
            selected={!filters.review}
          >
            Any review status
          </FilterChip>
          <FilterChip
            onSelect={() => onChange({ ...filters, review: "needs_review" })}
            selected={filters.review === "needs_review"}
          >
            Needs review
          </FilterChip>
          <FilterChip
            onSelect={() => onChange({ ...filters, review: "ready" })}
            selected={filters.review === "ready"}
          >
            Reviewed
          </FilterChip>
        </FilterChipGroup>
      </div>
      <label className="flex items-center gap-2 text-[length:var(--text-small)] text-muted-foreground">
        Sort
        <select
          aria-label="Sort assets"
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
          onChange={(event) =>
            onChange({ ...filters, sort: event.target.value as AssetFilters["sort"] })
          }
          value={filters.sort}
        >
          <option value="name">Name</option>
          <option value="due_action">Due action</option>
          <option value="needs_review">Review status</option>
          <option value="recently_added">Recently added</option>
        </select>
      </label>
    </div>
  );
}

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

function FilterChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toggle-button filter group, not a form fieldset
    <div aria-label={label} className="flex items-start gap-1.5" role="group">
      <span className="min-w-20 shrink-0 pt-1 text-[length:var(--text-caption)] text-muted-foreground">
        {label.replace("Filter by ", "").replace(/^./, (character) => character.toUpperCase())}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

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
