"use client";

import type { Table as TableInstance } from "@tanstack/react-table";
import type { ContactImportPreviewCandidate } from "@tendnote/db/queries/contacts-import-preview";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { plural } from "./review-model";

type Candidate = ContactImportPreviewCandidate;

const PAGE_SIZES = [10, 20, 50];

/** Narrow the table, then act on what's left: filter, bucket, bulk confirm. */
export function ReviewToolbar({
  table,
  busy,
  bulkCount,
  globalFilter,
  onGlobalFilterChange,
  onConfirmSafeBulk,
}: {
  table: TableInstance<Candidate>;
  busy: boolean;
  bulkCount: number;
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  onConfirmSafeBulk: () => void;
}) {
  const statusFilter = (table.getColumn("bucket")?.getFilterValue() as string | undefined) ?? "all";

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter candidates by name, email, or phone"
            className="pl-8"
            onChange={(event) => onGlobalFilterChange(event.target.value)}
            placeholder="Filter by name, email, or phone"
            type="search"
            value={globalFilter}
          />
        </div>
        <Select
          onValueChange={(value) =>
            table.getColumn("bucket")?.setFilterValue(value === "all" ? undefined : value)
          }
          value={statusFilter}
        >
          <SelectTrigger className="w-full sm:w-40" size="sm">
            <SelectValue placeholder="All candidates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All candidates</SelectItem>
            <SelectItem value="review">Needs review</SelectItem>
            <SelectItem value="safe">Safe</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button disabled={busy || bulkCount === 0} onClick={onConfirmSafeBulk} size="sm">
        Confirm safe recommendations
        {bulkCount > 0 ? ` (${bulkCount})` : ""}
      </Button>
    </div>
  );
}

/** What's shown out of what exists, and how to page through it. */
export function ReviewFooter({
  table,
  totalCount,
  fetchedCount,
}: {
  table: TableInstance<Candidate>;
  totalCount: number;
  fetchedCount: number;
}) {
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        Showing {filteredCount} of {totalCount} {plural(totalCount, "candidate", "candidates")} ·{" "}
        {fetchedCount} fetched from Google.
      </p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[length:var(--text-small)] text-muted-foreground">Rows</span>
          <Select
            onValueChange={(value) => table.setPageSize(Number(value))}
            value={String(table.getState().pagination.pageSize)}
          >
            <SelectTrigger className="w-16" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-[length:var(--text-small)] text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            size="icon-sm"
            variant="outline"
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <Button
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            size="icon-sm"
            variant="outline"
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
