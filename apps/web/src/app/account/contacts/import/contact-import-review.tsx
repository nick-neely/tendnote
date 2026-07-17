"use client";

import {
  type Column,
  type ColumnDef,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ContactImportApplyResult,
  ContactImportPreviewCandidate,
} from "@tendnote/db/queries/contacts-import-preview";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  confirmContactImportCandidateAction,
  confirmSafeContactImportCandidatesAction,
} from "@/app/actions/contact-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Candidate = ContactImportPreviewCandidate;

// Row-exit / expansion easing budget. Kept short and calm; reduced-motion
// callers skip the delay entirely (see useReducedMotion).
const MOTION_MS = 180;

export function ContactImportReview({
  candidates,
  fetchedCount,
}: {
  candidates: Candidate[];
  fetchedCount: number;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  // Session-only working set. Seeded once from the server snapshot; skips and
  // confirms mutate it locally and it resets on the next page load.
  const [data, setData] = useState<Candidate[]>(() => candidates);
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Rows whose provider data drifted after the owner reviewed them. Persisted so
  // the "refresh to retry" state survives the toast and a silent retry loop is
  // visible on the row itself. Cleared by a refresh (the page remounts).
  const [staleIds, setStaleIds] = useState<ReadonlySet<string>>(() => new Set());
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [busy, setBusy] = useState(false);

  // Re-fetch the server preview: dynamic route → fresh provider data, new
  // fingerprints, and (via the page's key on the session id) a full remount.
  const refreshPreview = useCallback(() => {
    router.refresh();
  }, [router]);

  // Stable original ordering so re-added rows (undo / server no-op) land back
  // in place rather than at the end.
  const orderIndex = useMemo(
    () => new Map(candidates.map((candidate, index) => [candidate.id, index])),
    [candidates],
  );
  const sortByOrder = useCallback(
    (rows: Candidate[]) =>
      [...rows].sort(
        (left, right) => (orderIndex.get(left.id) ?? 0) - (orderIndex.get(right.id) ?? 0),
      ),
    [orderIndex],
  );

  const reinsert = useCallback(
    (rows: Candidate[]) => {
      setData((prev) => {
        const present = new Set(prev.map((row) => row.id));
        const missing = rows.filter((row) => !present.has(row.id));
        return missing.length ? sortByOrder([...prev, ...missing]) : prev;
      });
    },
    [sortByOrder],
  );

  const removeRows = useCallback(
    async (ids: string[]) => {
      if (reduceMotion) {
        setData((prev) => prev.filter((row) => !ids.includes(row.id)));
        return;
      }
      setRemovingIds((prev) => new Set([...prev, ...ids]));
      await wait(MOTION_MS);
      setData((prev) => prev.filter((row) => !ids.includes(row.id)));
      setRemovingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          next.delete(id);
        }
        return next;
      });
    },
    [reduceMotion],
  );

  const runConfirm = useCallback(
    async (
      confirmed: Candidate[],
      action: () => Promise<ContactImportApplyResult>,
      onDone: (result: ContactImportApplyResult, notImported: Candidate[]) => void,
    ) => {
      if (busy || confirmed.length === 0) {
        return;
      }
      setBusy(true);
      const ids = confirmed.map((candidate) => candidate.id);
      const pending = action();
      // Optimistically clear the rows so the table feels instant; reconcile
      // against the server result once it lands.
      await removeRows(ids);
      try {
        const result = await pending;
        if (result.errorMessage) {
          reinsert(confirmed);
          toast.error(result.errorMessage);
          return;
        }
        // Reconcile honestly against the workflow's own result: reinsert every
        // row that was not imported, and persistently mark drifted rows.
        const notImportedIds = new Set(result.notImported.map((entry) => entry.candidateId));
        const notImported = confirmed.filter((candidate) => notImportedIds.has(candidate.id));
        if (notImported.length > 0) {
          reinsert(notImported);
        }
        const staleRowIds = result.notImported
          .filter((entry) => entry.reason === "stale")
          .map((entry) => entry.candidateId);
        const importedRowIds = result.candidates.map((entry) => entry.candidateId);
        setStaleIds((prev) => {
          const next = new Set(prev);
          for (const id of importedRowIds) {
            next.delete(id);
          }
          for (const id of staleRowIds) {
            next.add(id);
          }
          return next;
        });
        if (staleRowIds.length > 0) {
          // One canonical stale message, kept distinct from any success toast.
          toast.error(STALE_NOTE, {
            action: { label: "Refresh preview", onClick: refreshPreview },
          });
        }
        onDone(result, notImported);
      } catch {
        reinsert(confirmed);
        toast.error("Something went wrong applying that import. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, reinsert, refreshPreview, removeRows],
  );

  // Shared outcome handling for the two single-candidate confirm paths. Stale
  // drift is surfaced centrally (toast + persistent row marker), so only a
  // non-stale failure needs a per-row message here.
  const reportSingleConfirm = useCallback(
    (candidate: Candidate, result: ContactImportApplyResult, notImported: Candidate[]) => {
      if (notImported.length > 0 || result.candidates.length === 0) {
        if (!isStale(result, candidate.id)) {
          toast.error(`Couldn't import ${candidate.displayName}.`);
        }
        return;
      }
      const [entry] = result.candidates;
      toast.success(
        entry?.createdPerson
          ? `Added ${candidate.displayName}`
          : `Updated ${candidate.displayName}`,
      );
    },
    [],
  );

  const confirmSafeRow = useCallback(
    (candidate: Candidate) => {
      void runConfirm(
        [candidate],
        () =>
          confirmContactImportCandidateAction({
            candidateId: candidate.id,
            fingerprint: candidate.fingerprint,
          }),
        (result, notImported) => reportSingleConfirm(candidate, result, notImported),
      );
    },
    [reportSingleConfirm, runConfirm],
  );

  const applyResolution = useCallback(
    (candidate: Candidate, resolution: ResolutionChoice) => {
      void runConfirm(
        [candidate],
        () =>
          confirmContactImportCandidateAction({
            candidateId: candidate.id,
            fingerprint: candidate.fingerprint,
            targetPersonId: resolution.targetPersonId,
            createPerson: resolution.createPerson,
            birthdayChoice: resolution.birthdayChoice,
          }),
        (result, notImported) => reportSingleConfirm(candidate, result, notImported),
      );
    },
    [reportSingleConfirm, runConfirm],
  );

  const skipRow = useCallback(
    (candidate: Candidate) => {
      // Session-only: remove locally and offer an inline undo. Never hits the
      // server — the row returns on the next page load.
      void removeRows([candidate.id]);
      toast(`Skipped ${candidate.displayName}`, {
        description: "Hidden for this session.",
        action: {
          label: "Undo",
          onClick: () => reinsert([candidate]),
        },
      });
    },
    [reinsert, removeRows],
  );

  const columns = useMemo<ColumnDef<Candidate>[]>(
    () => [
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
        cell: ({ row }) => {
          const candidate = row.original;
          return (
            <div className="flex min-w-0 items-start gap-2.5 py-0.5">
              <UsersRoundIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{candidate.displayName}</span>
                <span className="truncate text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
                  {primaryContact(candidate)}
                </span>
                {staleIds.has(candidate.id) ? (
                  <span className="mt-1 flex items-start gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-accent">
                    <TriangleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
                    <span className="text-pretty">{STALE_NOTE}</span>
                  </span>
                ) : null}
              </div>
            </div>
          );
        },
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
          reviewStateOrder(left.original.reviewState) -
          reviewStateOrder(right.original.reviewState),
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
                onClick={() => confirmSafeRow(row.original)}
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
    ],
    [busy, confirmSafeRow, staleIds],
  );

  const table = useReactTable({
    data,
    columns,
    getRowId: (candidate) => candidate.id,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    enableRowSelection: (row) => row.original.safeBulkEligible,
    getRowCanExpand: (row) => !row.original.safeBulkEligible,
    initialState: {
      columnVisibility: { bucket: false },
      pagination: { pageSize: 10 },
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const safeCandidates = useMemo(
    () => data.filter((candidate) => candidate.safeBulkEligible),
    [data],
  );
  const selectedSafe = table.getSelectedRowModel().rows.map((row) => row.original);
  const bulkTargets = selectedSafe.length > 0 ? selectedSafe : safeCandidates;

  const confirmSafeBulk = useCallback(() => {
    if (bulkTargets.length === 0) {
      return;
    }
    void runConfirm(
      bulkTargets,
      () =>
        confirmSafeContactImportCandidatesAction({
          candidates: bulkTargets.map((candidate) => ({
            candidateId: candidate.id,
            fingerprint: candidate.fingerprint,
          })),
        }),
      (result) => {
        table.resetRowSelection();
        // Stale drift gets its own distinct toast (from runConfirm); the success
        // toast stays clean and only speaks to what actually landed.
        if (result.importedCount === 0) {
          if (!result.notImported.some((entry) => entry.reason === "stale")) {
            toast.info("No contacts were imported.");
          }
          return;
        }
        const detail = [
          result.createdPeople > 0 ? `${result.createdPeople} added` : null,
          result.updatedPeople > 0 ? `${result.updatedPeople} updated` : null,
          result.addedContactMethods > 0
            ? `${result.addedContactMethods} contact ${plural(result.addedContactMethods, "method", "methods")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        toast.success(
          `Confirmed ${result.importedCount} ${plural(result.importedCount, "contact", "contacts")}`,
          detail ? { description: detail } : undefined,
        );
      },
    );
  }, [bulkTargets, runConfirm, table]);

  const filteredCount = table.getFilteredRowModel().rows.length;
  const statusFilter = (table.getColumn("bucket")?.getFilterValue() as string | undefined) ?? "all";

  if (data.length === 0) {
    return (
      <EmptyState>
        {fetchedCount === 0
          ? "No contacts were fetched from Google."
          : "Every fetched contact has been handled for this session."}
      </EmptyState>
    );
  }

  return (
    <section className="flex flex-col gap-3">
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
              onChange={(event) => setGlobalFilter(event.target.value)}
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
        <Button disabled={busy || bulkTargets.length === 0} onClick={confirmSafeBulk} size="sm">
          Confirm safe recommendations
          {bulkTargets.length > 0 ? ` (${bulkTargets.length})` : ""}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-surface">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow className="hover:bg-transparent" key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    className="text-[length:var(--text-caption)] font-medium text-muted-foreground"
                    key={header.id}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  className="h-24 whitespace-normal text-center text-muted-foreground"
                  colSpan={table.getVisibleFlatColumns().length}
                >
                  No candidates match these filters.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <RowGroup key={row.id}>
                  <TableRow
                    className="align-top transition-opacity duration-150 ease-(--motion-ease-out) data-[removing=true]:opacity-0"
                    data-removing={removingIds.has(row.id) ? "true" : undefined}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell className="whitespace-normal" key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getCanExpand() ? (
                    <tr className="border-0 hover:bg-transparent" data-slot="table-row">
                      <td className="p-0" colSpan={row.getVisibleCells().length}>
                        <div
                          className="grid transition-[grid-template-rows] duration-200 ease-(--motion-ease-out) data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]"
                          data-state={row.getIsExpanded() ? "open" : "closed"}
                        >
                          <div className="overflow-hidden">
                            <ResolutionZone
                              busy={busy}
                              candidate={row.original}
                              onApply={(resolution) => applyResolution(row.original, resolution)}
                              onSkip={() => skipRow(row.original)}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </RowGroup>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Showing {filteredCount} of {data.length} {plural(data.length, "candidate", "candidates")}{" "}
          · {fetchedCount} fetched from Google.
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
                {[10, 20, 50].map((size) => (
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
    </section>
  );
}

type ResolutionChoice = {
  targetPersonId?: string | null;
  createPerson?: boolean;
  birthdayChoice?: "provider" | "existing" | "skip";
};

function ResolutionZone({
  candidate,
  busy,
  onApply,
  onSkip,
}: {
  candidate: Candidate;
  busy: boolean;
  onApply: (resolution: ResolutionChoice) => void;
  onSkip: () => void;
}) {
  // Every eligibility rule below is decided by the workflow and read straight
  // from `decisions`; the UI never re-derives who can be a target, whether a new
  // person may be created, or when a birthday choice is required.
  const { targets, targetChoiceRequired, canCreatePerson, birthdayChoiceRequired, resolvable } =
    candidate.decisions;
  const hasNamedTarget = targets.length > 0;
  // Skip-only: matched to more than one person, or otherwise unresolvable here.
  const unresolvableTarget = !resolvable;
  const [targetPersonId, setTargetPersonId] = useState(
    targetChoiceRequired ? "" : (targets[0]?.personId ?? ""),
  );
  const [birthdayChoice, setBirthdayChoice] = useState<"existing" | "provider">("existing");

  return (
    // Recessed decision zone stepped down onto --panel, full-bleed to the row
    // edges (clipped by the table's rounded overflow-hidden). Flat: border +
    // fill, no shadow, no nested card.
    <div className="flex flex-col gap-2.5 border-t bg-panel px-3.5 py-3">
      {(candidate.conflicts.length > 0 || candidate.advisoryMatches.length > 0) && (
        <ul className="flex flex-col gap-1">
          {candidate.conflicts.map((conflict) => (
            <li
              className="flex items-start gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
              key={`${conflict.type}:${conflict.message}`}
            >
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent" />
              <span>{conflict.message}</span>
            </li>
          ))}
          {candidate.advisoryMatches.map((match) => (
            <li
              className="flex items-start gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
              key={`${match.personId}:${match.reason}`}
            >
              <UsersRoundIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Advisory: {match.displayName} · {match.reason}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasNamedTarget ? (
        <div className="flex flex-col gap-2">
          {targetChoiceRequired ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-foreground">
                Choose target person
              </legend>
              {/* Heavily-matched contacts stay calm: cap the height and scroll
                  the overflow rather than letting the row grow unbounded. */}
              <div
                className={
                  targets.length > TARGET_LIST_CAP
                    ? "flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-1"
                    : "flex flex-col gap-1.5"
                }
              >
                {targets.map((target) => (
                  <label
                    className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]"
                    key={target.personId}
                  >
                    <input
                      checked={targetPersonId === target.personId}
                      className={RADIO_CLASS}
                      name={`target-${candidate.id}`}
                      onChange={() => setTargetPersonId(target.personId)}
                      type="radio"
                      value={target.personId}
                    />
                    <span>{target.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {birthdayChoiceRequired ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[length:var(--text-small)] font-medium text-muted-foreground">
                Birthday
              </legend>
              <label className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
                <input
                  checked={birthdayChoice === "existing"}
                  className={RADIO_CLASS}
                  name={`birthday-${candidate.id}`}
                  onChange={() => setBirthdayChoice("existing")}
                  type="radio"
                />
                <span>Keep Tendnote birthday</span>
              </label>
              <label className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
                <input
                  checked={birthdayChoice === "provider"}
                  className={RADIO_CLASS}
                  name={`birthday-${candidate.id}`}
                  onChange={() => setBirthdayChoice("provider")}
                  type="radio"
                />
                <span>Use provider birthday</span>
              </label>
            </fieldset>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy || (targetChoiceRequired && !targetPersonId)}
              onClick={() =>
                onApply({
                  targetPersonId: targetPersonId || null,
                  birthdayChoice: birthdayChoiceRequired ? birthdayChoice : undefined,
                })
              }
              size="sm"
              variant="outline"
            >
              Apply resolution
            </Button>
            <Button disabled={busy} onClick={onSkip} size="sm" variant="ghost">
              Skip
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {canCreatePerson ? (
            <Button
              disabled={busy}
              onClick={() => onApply({ createPerson: true })}
              size="sm"
              variant="outline"
            >
              Create new person
            </Button>
          ) : null}
          {unresolvableTarget ? (
            <p className="flex-1 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
              This contact matches more than one person. Open those people to attach or merge it, or
              skip it here.
            </p>
          ) : null}
          <Button disabled={busy} onClick={onSkip} size="sm" variant="ghost">
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  // A fragment keeps the primary row and its expansion row as siblings inside
  // <tbody> without an intervening wrapper element.
  return <>{children}</>;
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
  return <span className="text-muted-foreground">—</span>;
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-dashed bg-surface px-3.5 py-6 text-center">
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-muted-foreground">
        {children}
      </p>
    </section>
  );
}

const RADIO_CLASS =
  "size-4 shrink-0 rounded-full [accent-color:var(--primary)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

// Above this many possible targets, scroll the radio list instead of growing
// the row; keeps heavily-matched contacts calm.
const TARGET_LIST_CAP = 4;

// Review-needed states sort ahead of safe ones so the work surfaces first.
function reviewStateOrder(state: Candidate["reviewState"]): number {
  const order: Record<Candidate["reviewState"], number> = {
    conflict: 0,
    ambiguous_duplicate: 1,
    advisory_match: 2,
    individual_review: 3,
    weak_match: 4,
    safe_recommendation: 5,
  };
  return order[state] ?? 9;
}

const globalFilterFn: FilterFn<Candidate> = (row, _columnId, value) => {
  const query = String(value).trim().toLowerCase();
  if (!query) {
    return true;
  }
  const candidate = row.original;
  return [
    candidate.displayName,
    candidate.matchedPerson?.displayName ?? "",
    ...candidate.emails,
    ...candidate.phones,
  ].some((field) => field.toLowerCase().includes(query));
};

function primaryContact(candidate: Candidate): string {
  return candidate.emails[0] ?? candidate.phones[0] ?? "No email or phone";
}

// The one canonical phrase for provider drift (fingerprint mismatch). Reused by
// the toast and the persistent row marker so the concept reads identically.
const STALE_NOTE = "Changed in Google Contacts since you previewed — refresh to retry.";

// Whether the workflow refused this candidate because its provider data drifted
// after the owner reviewed it.
function isStale(result: ContactImportApplyResult, candidateId: string): boolean {
  return result.notImported.some(
    (entry) => entry.candidateId === candidateId && entry.reason === "stale",
  );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduce(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduce;
}
