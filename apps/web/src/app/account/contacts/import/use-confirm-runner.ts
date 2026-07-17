"use client";

import type {
  ContactImportApplyResult,
  ContactImportPreviewCandidate,
} from "@tendnote/db/queries/contacts-import-preview";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  APPLY_FAILED_NOTE,
  type ApplyReconciliation,
  canConfirm,
  nextStaleIds,
  reconcileApply,
  STALE_NOTE,
} from "./review-model";
import type { ReviewWorkingSet } from "./use-review-working-set";

type Candidate = ContactImportPreviewCandidate;

/**
 * The one path a confirmation takes, whatever asked for it: a single safe row, a
 * resolved row, or the whole safe bulk.
 *
 * It owns the honest part of an optimistic table — the rows clear immediately, and
 * this reconciles that guess against the workflow's own result: refusals come back,
 * drift is marked persistently and announced once, and a failure restores
 * everything. Callers supply only the action and what to say afterwards; none of
 * them can skip the reconciliation, so no confirm path can quietly claim a row
 * landed when it did not.
 */
export type ConfirmRunner = {
  /** A confirm is in flight; every control is inert until it settles. */
  busy: boolean;
  /** Rows whose provider data drifted after the owner reviewed them. */
  staleIds: ReadonlySet<string>;
  runConfirm: (
    confirmed: Candidate[],
    action: () => Promise<ContactImportApplyResult>,
    onDone: (result: ContactImportApplyResult, notImported: Candidate[]) => void,
  ) => Promise<void>;
};

export function useConfirmRunner({ reinsert, removeRows }: ReviewWorkingSet): ConfirmRunner {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Persisted so the "refresh to retry" state survives the toast and a silent retry
  // loop is visible on the row itself. Cleared by a refresh (the page remounts).
  const [staleIds, setStaleIds] = useState<ReadonlySet<string>>(() => new Set());

  // Land the workflow's verdict on the table: refused rows come back, drift markers
  // are updated, and drift gets the one canonical message plus a way out.
  const settle = useCallback(
    (reconciliation: ApplyReconciliation) => {
      if (reconciliation.notImported.length > 0) {
        reinsert(reconciliation.notImported);
      }
      setStaleIds((prev) => nextStaleIds(prev, reconciliation));
      if (reconciliation.staleRowIds.length > 0) {
        toast.error(STALE_NOTE, {
          // Re-fetching the preview is the only real way out: a dynamic route →
          // fresh provider data, new fingerprints, and a full remount.
          action: { label: "Refresh preview", onClick: () => router.refresh() },
        });
      }
    },
    [reinsert, router],
  );

  const runConfirm = useCallback(
    async (
      confirmed: Candidate[],
      action: () => Promise<ContactImportApplyResult>,
      onDone: (result: ContactImportApplyResult, notImported: Candidate[]) => void,
    ) => {
      if (!canConfirm(busy, confirmed)) {
        return;
      }
      setBusy(true);
      const pending = action();
      // Optimistically clear the rows so the table feels instant; reconcile
      // against the server result once it lands.
      await removeRows(confirmed.map((candidate) => candidate.id));
      try {
        const result = await pending;
        if (result.errorMessage) {
          // The workflow refused the whole call and said why; its own words beat
          // any generic phrasing here.
          reinsert(confirmed);
          toast.error(result.errorMessage);
          return;
        }
        const reconciliation = reconcileApply(confirmed, result);
        settle(reconciliation);
        onDone(result, reconciliation.notImported);
      } catch {
        reinsert(confirmed);
        toast.error(APPLY_FAILED_NOTE);
      } finally {
        setBusy(false);
      }
    },
    [busy, reinsert, removeRows, settle],
  );

  return { busy, staleIds, runConfirm };
}
