"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A locally-editable list that also absorbs items the server adds out of band —
 * the instant-feedback primitive for cross-component updates.
 *
 * Sections on a page keep their own optimistic state (remove a row on dismiss,
 * edit it in place) for snappy local feedback. But some changes originate in a
 * sibling: accepting a suggested follow-up promotes it into the active reminders
 * list; starting a draft adds one to the drafts list. Those siblings call
 * `router.refresh()`, which re-renders the server tree and hands this component a
 * fresh `serverItems` prop. A plain `useState(initial)` would ignore it; this
 * hook merges in anything new (by id) without clobbering the user's local edits
 * or removals, so the item shows up automatically — no manual refresh.
 *
 * It only *adds* server items it hasn't seen before. Removals and edits stay
 * authoritative locally (they're always user-initiated in the owning section),
 * so a refresh never resurrects a row the user just dismissed.
 */
export function useServerSyncedList<T>(
  serverItems: T[],
  getId: (item: T) => string,
  sort?: (items: T[]) => T[],
  getRevision?: (item: T) => string | undefined,
): [T[], React.Dispatch<React.SetStateAction<T[]>>] {
  const [items, setItems] = useState(serverItems);

  // Every id ever seen from the server; new ones are genuine out-of-band adds.
  const seenIds = useRef(new Set(serverItems.map(getId)));
  // Keep callbacks current without making them effect dependencies.
  const getIdRef = useRef(getId);
  getIdRef.current = getId;
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const getRevisionRef = useRef(getRevision);
  getRevisionRef.current = getRevision;

  useEffect(() => {
    const id = getIdRef.current;
    const additions = serverItems.filter((item) => !seenIds.current.has(id(item)));

    for (const item of serverItems) {
      seenIds.current.add(id(item));
    }

    setItems((current) => {
      const currentIds = new Set(current.map(id));
      const fresh = additions.filter((item) => !currentIds.has(id(item)));
      const revision = getRevisionRef.current;
      const replacements = revision
        ? serverItems.filter((item) => {
            const existing = current.find((candidate) => id(candidate) === id(item));
            const currentRevision = existing ? revision(existing) : undefined;
            const incomingRevision = revision(item);
            return Boolean(
              existing &&
                incomingRevision &&
                (!currentRevision || incomingRevision > currentRevision),
            );
          })
        : [];

      if (fresh.length === 0 && replacements.length === 0) {
        return current;
      }

      const replacementById = new Map(replacements.map((item) => [id(item), item]));
      const next = [...current.map((item) => replacementById.get(id(item)) ?? item), ...fresh];

      return sortRef.current ? sortRef.current(next) : next;
    });
  }, [serverItems]);

  return [items, setItems];
}
