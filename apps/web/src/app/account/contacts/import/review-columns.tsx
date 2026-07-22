"use client";

import type { Column, ColumnDef } from "@tanstack/react-table";
import type { ContactImportPreviewCandidate } from "@tendnote/db/queries/contacts-import-preview";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  PlusIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { primaryContact, reviewStateOrder, STALE_NOTE } from "./review-model";

type Candidate = ContactImportPreviewCandidate;

/**
 * The review table's column shape: which facts each row shows and which affordance
 * it earns. Everything a column needs from the surface arrives through
 * {@link ReviewColumnContext}; nothing here reaches back into the table's state.
 */
export type ReviewColumnContext = {
  /** A confirm is in flight; every row control is inert until it settles. */
  busy: boolean;
  /** Rows whose provider data drifted after the owner reviewed them. */
  staleIds: ReadonlySet<string>;
  onConfirmSafe: (candidate: Candidate) => void;
};

export function reviewColumns({
  busy,
  staleIds,
  onConfirmSafe,
}: ReviewColumnContext): ColumnDef<Candidate>[] {
  return [
    {
      id: "select",
      enableSorting: false,
      enableGlobalFilter: false,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all safe recommendations"
          checked={
            table.getIsAllRowsSelected()
              ? true
              : table.getIsSomeRowsSelected()
                ? "indeterminate"
                : false
          }
          disabled={busy}
          onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
        />
      ),
      cell: ({ row }) =>
        row.getCanSelect() ? (
          <Checkbox
            aria-label={`Select ${row.original.displayName}`}
            checked={row.getIsSelected()}
            disabled={busy}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
          />
        ) : null,
    },
    {
      id: "person",
      accessorKey: "displayName",
      enableGlobalFilter: true,
      sortingFn: "text",
      header: ({ column }) => <SortHeader column={column} label="Person" />,
      cell: ({ row }) => (
        <PersonCell candidate={row.original} stale={staleIds.has(row.original.id)} />
      ),
    },
    {
      id: "match",
      enableSorting: false,
      enableGlobalFilter: false,
      header: "Match",
      cell: ({ row }) => <MatchCell candidate={row.original} />,
    },
    {
      id: "state",
      accessorFn: (candidate) => candidate.reviewState,
      enableGlobalFilter: false,
      sortingFn: (left, right) =>
        reviewStateOrder(left.original.reviewState) - reviewStateOrder(right.original.reviewState),
      header: ({ column }) => <SortHeader column={column} label="State" />,
      cell: ({ row }) => <ReviewStateBadge state={row.original.reviewState} />,
    },
    {
      id: "bucket",
      accessorFn: (candidate) => (candidate.safeBulkEligible ? "safe" : "review"),
      enableSorting: false,
      enableGlobalFilter: false,
      filterFn: (row, columnId, value) => row.getValue(columnId) === value,
    },
    {
      id: "actions",
      enableSorting: false,
      enableGlobalFilter: false,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          {row.original.safeBulkEligible ? (
            <Button
              disabled={busy}
              onClick={() => onConfirmSafe(row.original)}
              size="sm"
              variant="outline"
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              Add
            </Button>
          ) : (
            <Button
              aria-expanded={row.getIsExpanded()}
              disabled={busy}
              onClick={() => row.toggleExpanded()}
              size="sm"
              variant="ghost"
            >
              Resolve
              <ChevronDownIcon
                aria-hidden
                className="transition-transform duration-150 ease-(--motion-ease-out) group-aria-expanded/button:rotate-180"
                data-icon="inline-end"
              />
            </Button>
          )}
        </div>
      ),
    },
  ];
}

function PersonCell({ candidate, stale }: { candidate: Candidate; stale: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 py-0.5">
      <UsersRoundIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{candidate.displayName}</span>
        <span className="truncate text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
          {primaryContact(candidate)}
        </span>
        {stale ? (
          <span className="mt-1 flex items-start gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-accent">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span className="text-pretty">{STALE_NOTE}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MatchCell({ candidate }: { candidate: Candidate }) {
  if (candidate.matchedPerson) {
    return (
      <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        Matches {candidate.matchedPerson.displayName}
      </span>
    );
  }
  const advisory = candidate.advisoryMatches[0];
  if (advisory) {
    return (
      <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        Possible: {advisory.displayName}
      </span>
    );
  }
  const conflict = candidate.conflicts[0];
  if (conflict) {
    return (
      <span className="flex items-start gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent" />
        Needs review
      </span>
    );
  }
  return <span className="text-muted-foreground">No match</span>;
}

function SortHeader({ column, label }: { column: Column<Candidate, unknown>; label: string }) {
  const sorted = column.getIsSorted();
  const Icon =
    sorted === "asc" ? ChevronUpIcon : sorted === "desc" ? ChevronDownIcon : ChevronsUpDownIcon;

  return (
    <Button
      className="-ml-2 h-7 gap-1 px-2 text-muted-foreground data-[sorted=true]:text-foreground"
      data-sorted={sorted ? "true" : undefined}
      onClick={() => column.toggleSorting(sorted === "asc")}
      size="sm"
      variant="ghost"
    >
      {label}
      <Icon aria-hidden className="size-3.5 opacity-70" />
    </Button>
  );
}

// Clay accent is the system's "needs review" weight (DESIGN §3): a single state
// badge, icon + text so the state never rests on color alone.
const REVIEW_STATE_META: Record<
  string,
  { label: string; tone: "neutral" | "review"; Icon?: LucideIcon }
> = {
  safe_recommendation: { label: "Safe", tone: "neutral" },
  conflict: { label: "Conflict", tone: "review", Icon: TriangleAlertIcon },
  ambiguous_duplicate: { label: "Ambiguous", tone: "review", Icon: TriangleAlertIcon },
  advisory_match: { label: "Advisory", tone: "neutral", Icon: UsersRoundIcon },
  individual_review: { label: "Review", tone: "neutral" },
  weak_match: { label: "Weak", tone: "neutral" },
};

function ReviewStateBadge({ state }: { state: string }) {
  const meta = REVIEW_STATE_META[state] ?? { label: "Review", tone: "neutral" as const };
  const Icon = meta.Icon;

  return (
    <Badge
      className={meta.tone === "review" ? "border-accent/30 bg-accent/10 text-accent" : undefined}
      variant="outline"
    >
      {Icon ? <Icon aria-hidden data-icon="inline-start" /> : null}
      {meta.label}
    </Badge>
  );
}
