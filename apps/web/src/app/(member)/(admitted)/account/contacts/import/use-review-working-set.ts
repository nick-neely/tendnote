"use client";

import type { ContactImportPreviewCandidate } from "@tendnote/db/queries/contacts-import-preview";
import { useCallback, useMemo, useState } from "react";
import { orderIndexOf, withoutRows, withReinserted } from "./review-model";

type Candidate = ContactImportPreviewCandidate;

// Row-exit easing budget. Kept short and calm; reduced-motion callers skip the
// delay entirely (see useReducedMotion).
const MOTION_MS = 180;

/**
 * The session-only working set of candidates: which rows the table is showing, and
 * how rows leave and come back.
 *
 * Seeded once from the server snapshot; every skip and confirm mutates it locally
 * and it resets on the next page load. Rows leave optimistically so the table feels
 * instant, which means they must be able to return — a skip's undo and a workflow
 * refusal both land as {@link ReviewWorkingSet.reinsert}, and a returning row goes
 * back to its original position rather than the end.
 */
export type ReviewWorkingSet = {
  data: Candidate[];
  /** Rows mid-exit; they fade before leaving the DOM. */
  removingIds: ReadonlySet<string>;
  /** Fade rows out, then drop them. Resolves once they are gone. */
  removeRows: (ids: string[]) => Promise<void>;
  /** Return rows to their original position, ignoring any already present. */
  reinsert: (rows: Candidate[]) => void;
};

export function useReviewWorkingSet(
  candidates: Candidate[],
  reduceMotion: boolean,
): ReviewWorkingSet {
  const [data, setData] = useState<Candidate[]>(() => candidates);
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(() => new Set());

  const orderIndex = useMemo(() => orderIndexOf(candidates), [candidates]);

  const reinsert = useCallback(
    (rows: Candidate[]) => {
      setData((prev) => withReinserted(prev, rows, orderIndex));
    },
    [orderIndex],
  );

  const removeRows = useCallback(
    async (ids: string[]) => {
      if (reduceMotion) {
        setData((prev) => withoutRows(prev, ids));
        return;
      }
      setRemovingIds((prev) => new Set([...prev, ...ids]));
      await wait(MOTION_MS);
      setData((prev) => withoutRows(prev, ids));
      setRemovingIds((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
    },
    [reduceMotion],
  );

  return { data, removingIds, removeRows, reinsert };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
