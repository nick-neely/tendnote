"use client";

import {
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  type Table,
  useReactTable,
} from "@tanstack/react-table";
import type { ContactImportPreviewCandidate } from "@tendnote/db/queries/contacts-import-preview";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  confirmContactImportCandidateAction,
  confirmSafeContactImportCandidatesAction,
} from "@/app/actions/contact-import";
import type { ResolutionChoice } from "./resolution-zone";
import { reviewColumns } from "./review-columns";
import { bulkConfirmPlan, matchesQuery, singleConfirmPlan } from "./review-model";
import { presentToast } from "./review-toasts";
import { useConfirmRunner } from "./use-confirm-runner";
import { useReducedMotion } from "./use-reduced-motion";
import { useReviewWorkingSet } from "./use-review-working-set";

type Candidate = ContactImportPreviewCandidate;

/**
 * Everything the contact import review surface does, assembled from its three parts:
 * the session working set (`useReviewWorkingSet`), the confirmation path
 * (`useConfirmRunner`), and the table instance.
 *
 * What is left here is only the wiring: which server action each affordance calls and
 * which sentence it produces. The components above take what this returns and render
 * it — they hold no state and decide no outcome, so "what happens when the owner
 * presses Add" has exactly one place to live.
 */
export type ContactImportReview = {
  /** The session working set: what the table is actually showing. */
  data: Candidate[];
  table: Table<Candidate>;
  /** Rows mid-exit; they fade before leaving the DOM. */
  removingIds: ReadonlySet<string>;
  /** A confirm is in flight. */
  busy: boolean;
  /** The rows a bulk confirm would apply to: the selection, or every safe row. */
  bulkTargets: Candidate[];
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  confirmSafeBulk: () => void;
  applyResolution: (candidate: Candidate, resolution: ResolutionChoice) => void;
  skipRow: (candidate: Candidate) => void;
};

export function useContactImportReview(candidates: Candidate[]): ContactImportReview {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const workingSet = useReviewWorkingSet(candidates, useReducedMotion());
  const { data, removingIds, reinsert, removeRows } = workingSet;
  const { busy, staleIds, runConfirm } = useConfirmRunner(workingSet);

  // Both single-candidate paths differ only in the choices they send; the outcome
  // they report is the same.
  const confirmOne = useCallback(
    (candidate: Candidate, resolution?: ResolutionChoice) => {
      void runConfirm(
        [candidate],
        () =>
          confirmContactImportCandidateAction({
            candidateId: candidate.id,
            fingerprint: candidate.fingerprint,
            targetPersonId: resolution?.targetPersonId,
            createPerson: resolution?.createPerson,
            birthdayChoice: resolution?.birthdayChoice,
          }),
        (result, notImported) => presentToast(singleConfirmPlan(candidate, result, notImported)),
      );
    },
    [runConfirm],
  );

  const applyResolution = useCallback(
    (candidate: Candidate, resolution: ResolutionChoice) => confirmOne(candidate, resolution),
    [confirmOne],
  );

  const skipRow = useCallback(
    (candidate: Candidate) => {
      // Session-only: remove locally and offer an inline undo. Never hits the
      // server — the row returns on the next page load.
      void removeRows([candidate.id]);
      toast(`Skipped ${candidate.displayName}`, {
        description: "Hidden for this session.",
        action: { label: "Undo", onClick: () => reinsert([candidate]) },
      });
    },
    [reinsert, removeRows],
  );

  const columns = useMemo(
    () => reviewColumns({ busy, staleIds, onConfirmSafe: confirmOne }),
    [busy, confirmOne, staleIds],
  );

  const table = useReactTable({
    data,
    columns,
    getRowId: (candidate) => candidate.id,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, value) => matchesQuery(row.original, value),
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

  // An explicit selection wins; with none, the button acts on every safe row.
  const selectedSafe = table.getSelectedRowModel().rows.map((row) => row.original);
  const safeCandidates = useMemo(
    () => data.filter((candidate) => candidate.safeBulkEligible),
    [data],
  );
  const bulkTargets = selectedSafe.length > 0 ? selectedSafe : safeCandidates;

  const confirmSafeBulk = useCallback(() => {
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
        presentToast(bulkConfirmPlan(result));
      },
    );
  }, [bulkTargets, runConfirm, table]);

  return {
    data,
    table,
    removingIds,
    busy,
    bulkTargets,
    globalFilter,
    setGlobalFilter,
    confirmSafeBulk,
    applyResolution,
    skipRow,
  };
}
