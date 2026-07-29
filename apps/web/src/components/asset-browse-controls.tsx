"use client";

import type { AssetKind, PrivacyScope } from "@tendnote/domain";
import { ASSET_KIND_OPTIONS, assetLabelForKind } from "@tendnote/domain";
import { visibilityLabelForScope } from "@tendnote/domain/privacy";
import { useId, useMemo, useState } from "react";
import { ChevronDownIcon, SlidersHorizontalIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AssetBrowseRequest, AssetView } from "@/lib/asset-view";

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

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The "no opinion" value for a single-select group. Radix `ToggleGroup type="single"`
 * speaks in strings, so every row carries an explicit neutral option rather than
 * asking the user to deduce that clicking the selected chip again clears it.
 */
const ANY = "any";

const STATE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "Everything" },
] as const satisfies ReadonlyArray<{ value: AssetStateFilter; label: string }>;

const DUE_OPTIONS = [
  { value: "with_due_action", label: "Has due action" },
  { value: "without_due_action", label: "No due action" },
] as const;

const REVIEW_OPTIONS = [
  { value: "needs_review", label: "Needs review" },
  { value: "ready", label: "Reviewed" },
] as const;

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "due_action", label: "Due action" },
  { value: "needs_review", label: "Review status" },
  { value: "recently_added", label: "Recently added" },
] as const satisfies ReadonlyArray<{ value: AssetFilters["sort"]; label: string }>;

const SCOPES = ["private", "shared", "household"] as const satisfies readonly PrivacyScope[];

function labelFor<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// URL persistence
// ---------------------------------------------------------------------------

/**
 * The selection lives in the URL, not in component state, so a reload, a shared
 * link, and the back button all land on the same ledger. Only non-default values
 * are written: an unfiltered Assets page keeps a bare `/assets`.
 */
function readParam<T extends string>(
  params: Pick<URLSearchParams, "get">,
  key: string,
  allowed: readonly T[],
): T | null {
  const raw = params.get(key);
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

export function assetFiltersFromParams(params: Pick<URLSearchParams, "get">): AssetFilters {
  const kinds = ASSET_KIND_OPTIONS.map((option) => option.kind);
  return {
    kind: readParam(params, "kind", kinds),
    state:
      readParam(
        params,
        "state",
        STATE_OPTIONS.map((option) => option.value),
      ) ?? DEFAULT_ASSET_FILTERS.state,
    scope: readParam(params, "scope", SCOPES),
    due: readParam(
      params,
      "due",
      DUE_OPTIONS.map((option) => option.value),
    ),
    review: readParam(
      params,
      "review",
      REVIEW_OPTIONS.map((option) => option.value),
    ),
    sort:
      readParam(
        params,
        "sort",
        SORT_OPTIONS.map((option) => option.value),
      ) ?? DEFAULT_ASSET_FILTERS.sort,
  };
}

/**
 * Rewrites the filter keys on top of the URL's existing query, leaving anything
 * else the page carries untouched. Returns a bare query string (no leading `?`).
 */
export function assetFilterSearch(filters: AssetFilters, currentSearch: string): string {
  const next = new URLSearchParams(currentSearch);
  const write = (key: string, value: string | null, fallback: string | null) => {
    if (value === null || value === fallback) next.delete(key);
    else next.set(key, value);
  };
  write("kind", filters.kind, null);
  write("state", filters.state, DEFAULT_ASSET_FILTERS.state);
  write("scope", filters.scope, null);
  write("due", filters.due, null);
  write("review", filters.review, null);
  write("sort", filters.sort, DEFAULT_ASSET_FILTERS.sort);
  return next.toString();
}

export function sameAssetFilters(left: AssetFilters, right: AssetFilters): boolean {
  return (
    left.kind === right.kind &&
    left.state === right.state &&
    left.scope === right.scope &&
    left.due === right.due &&
    left.review === right.review &&
    left.sort === right.sort
  );
}

/**
 * Whether the selection can hide rows. Sort never can, so it is deliberately not
 * counted: a re-sorted empty ledger is still "nothing tracked yet".
 */
export function assetFiltersNarrow(filters: AssetFilters): boolean {
  return (
    filters.kind !== null ||
    filters.state !== DEFAULT_ASSET_FILTERS.state ||
    filters.scope !== null ||
    filters.due !== null ||
    filters.review !== null
  );
}

/**
 * Plain words for everything currently in force, so a collapsed panel never hides
 * state. Sort is included - it changes what the top of the list means.
 */
function activeAssetFilterLabels(filters: AssetFilters): string[] {
  const labels: string[] = [];
  if (filters.kind !== null) labels.push(assetLabelForKind(filters.kind));
  if (filters.state !== DEFAULT_ASSET_FILTERS.state) {
    labels.push(labelFor(STATE_OPTIONS, filters.state));
  }
  if (filters.scope !== null) labels.push(visibilityLabelForScope(filters.scope));
  if (filters.due !== null) labels.push(labelFor(DUE_OPTIONS, filters.due));
  if (filters.review !== null) labels.push(labelFor(REVIEW_OPTIONS, filters.review));
  if (filters.sort !== DEFAULT_ASSET_FILTERS.sort) {
    labels.push(`Sorted by ${labelFor(SORT_OPTIONS, filters.sort).toLowerCase()}`);
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * Every filter and the sort order, collapsed behind one quiet control on every
 * viewport.
 *
 * The surface used to sit under five permanently expanded rows of pills plus a
 * bare `<select>` - more chrome than ledger, and the audit called it button hell.
 * Mobile had already solved it with a "Filters and sort" disclosure, so desktop
 * adopts the mobile pattern rather than the other way round: calm by default, one
 * click from everything.
 *
 * Collapsing must never hide state, so whatever is in force is summarised beside
 * the trigger as neutral badges with a single clear-all. Inside, each row is a
 * single-select `ToggleGroup` (Radix gives it radiogroup semantics and one tab
 * stop with arrow-key movement, replacing twenty `aria-pressed` buttons) and sort
 * is the product's `Select`, so the whole block speaks one control vocabulary.
 *
 * Rows still appear only when they have something to narrow: a single-kind,
 * all-active, all-private client list shows no filter chrome at all.
 */
export function AssetBrowseControls({
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
  const [open, setOpen] = useState(false);
  const kindOptions = useMemo(() => {
    const stateVisible = filterAssets(list, { ...DEFAULT_ASSET_FILTERS, state: filters.state });
    const present = new Set(stateVisible.map((asset) => asset.kind));
    if (filters.kind !== null) present.add(filters.kind);
    const offered = serverBacked
      ? ASSET_KIND_OPTIONS
      : ASSET_KIND_OPTIONS.filter((option) => present.has(option.kind));
    return offered.map((option) => ({ value: option.kind, label: option.label }));
  }, [list, filters.state, filters.kind, serverBacked]);

  const showKind = kindOptions.length > 1;
  const showState = serverBacked || list.some((asset) => asset.archived);
  const showScope = serverBacked || list.some((asset) => asset.scope !== "private");
  if (!showKind && !showState && !showScope) return null;

  const active = activeAssetFilterLabels(filters);

  return (
    <Collapsible className="flex flex-col gap-2" onOpenChange={setOpen} open={open}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <CollapsibleTrigger asChild>
          <Button
            className="group/filters -ml-2.5 text-muted-foreground hover:text-foreground"
            size="sm"
            type="button"
            variant="ghost"
          >
            <SlidersHorizontalIcon aria-hidden />
            Filters and sort
            <ChevronDownIcon
              aria-hidden
              className="transition-transform duration-150 ease-(--motion-ease-out) group-data-[state=open]/filters:rotate-180 motion-reduce:transition-none"
            />
          </Button>
        </CollapsibleTrigger>
        {active.length ? (
          <>
            <ul aria-label="Filters in force" className="flex flex-wrap items-center gap-1.5">
              {active.map((label) => (
                <li key={label}>
                  <Badge variant="secondary">{label}</Badge>
                </li>
              ))}
            </ul>
            <Button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(DEFAULT_ASSET_FILTERS)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Clear all
            </Button>
          </>
        ) : null}
      </div>

      <CollapsibleContent className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-surface p-3">
        {showKind ? (
          <FilterToggleRow
            label="Kind"
            onValueChange={(kind) => onChange({ ...filters, kind })}
            options={kindOptions}
            optional="All kinds"
            value={filters.kind}
          />
        ) : null}
        {showState ? (
          <FilterToggleRow
            label="State"
            // No `optional` option, so `state` is always one of the three.
            onValueChange={(state) =>
              onChange({ ...filters, state: state ?? DEFAULT_ASSET_FILTERS.state })
            }
            options={STATE_OPTIONS}
            value={filters.state}
          />
        ) : null}
        {showScope ? (
          <FilterToggleRow
            label="Visibility"
            onValueChange={(scope) => onChange({ ...filters, scope })}
            options={SCOPES.map((scope) => ({
              value: scope,
              label: visibilityLabelForScope(scope),
            }))}
            optional="Any visibility"
            value={filters.scope}
          />
        ) : null}
        {serverBacked ? (
          <>
            <FilterToggleRow
              label="Due action"
              onValueChange={(due) => onChange({ ...filters, due })}
              options={DUE_OPTIONS}
              optional="Any timing"
              value={filters.due}
            />
            <FilterToggleRow
              label="Review status"
              onValueChange={(review) => onChange({ ...filters, review })}
              options={REVIEW_OPTIONS}
              optional="Any review status"
              value={filters.review}
            />
            <AssetSortRow
              onValueChange={(sort) => onChange({ ...filters, sort })}
              value={filters.sort}
            />
          </>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The shared row scaffold: a quiet caption label naming the axis, then its control.
 * The caption stacks above the options on a phone, where a fixed label gutter would
 * squeeze a seven-option row onto three lines.
 */
function FilterRow({
  children,
  label,
  labelId,
}: {
  children: React.ReactNode;
  label: string;
  labelId: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
      <span
        className="shrink-0 text-[length:var(--text-caption)] text-muted-foreground sm:min-w-24 sm:pt-1.5"
        id={labelId}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * One filter axis as a single-select toggle group.
 *
 * `optional` names the neutral choice for the axes that allow "no opinion" (kind,
 * visibility, due action, review status), and is the only way `null` reaches the
 * handler; omitting it makes every option concrete, which is what lifecycle state
 * needs - there is no "any state" once Everything exists. Deselecting the current
 * option is swallowed, so a row is never left with nothing chosen.
 */
function FilterToggleRow<T extends string>({
  label,
  onValueChange,
  options,
  optional,
  value,
}: {
  label: string;
  onValueChange: (value: T | null) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  optional?: string;
  value: T | null;
}) {
  const labelId = useId();
  return (
    <FilterRow label={label} labelId={labelId}>
      <ToggleGroup
        aria-labelledby={labelId}
        className="w-auto flex-1 flex-wrap justify-start"
        onValueChange={(next) => {
          if (next) onValueChange(next === ANY ? null : (next as T));
        }}
        size="sm"
        type="single"
        value={value ?? ANY}
        variant="outline"
      >
        {optional ? (
          <ToggleGroupItem className={FILTER_TOGGLE} value={ANY}>
            {optional}
          </ToggleGroupItem>
        ) : null}
        {options.map((option) => (
          <ToggleGroupItem className={FILTER_TOGGLE} key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FilterRow>
  );
}

/**
 * Selected state is a held-back sage tint rather than a sage fill: five rows of
 * solid primary chips would hand the panel most of the screen's color budget
 * (DESIGN.md §3), and the weight change keeps selection from resting on color.
 */
const FILTER_TOGGLE =
  "border-border text-muted-foreground hover:text-foreground data-[state=on]:border-primary/45 data-[state=on]:bg-primary/10 data-[state=on]:font-medium data-[state=on]:text-primary dark:data-[state=on]:bg-primary/15";

function AssetSortRow({
  onValueChange,
  value,
}: {
  onValueChange: (value: AssetFilters["sort"]) => void;
  value: AssetFilters["sort"];
}) {
  const labelId = useId();
  return (
    <FilterRow label="Sort" labelId={labelId}>
      <Select onValueChange={(next) => onValueChange(next as AssetFilters["sort"])} value={value}>
        <SelectTrigger aria-label="Sort assets" className="w-44" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterRow>
  );
}
