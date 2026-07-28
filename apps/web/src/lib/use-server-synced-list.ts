"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The one list reconciliation policy for cached server trees and local
 * acknowledgements: add genuinely new rows, replace only with a newer revision,
 * and preserve local order and locally removed rows.
 */
export function reconcileRevisionedItems<T>(
  current: T[],
  incoming: T[],
  getId: (item: T) => string,
  getRevision?: (item: T) => string | undefined,
  canAdd: (item: T) => boolean = () => true,
): T[] {
  const next = [...current];
  const indexById = new Map(next.map((item, index) => [getId(item), index]));
  let changed = false;

  for (const item of incoming) {
    const id = getId(item);
    const existingIndex = indexById.get(id);
    if (existingIndex === undefined) {
      if (!canAdd(item)) continue;
      indexById.set(id, next.length);
      next.push(item);
      changed = true;
      continue;
    }
    if (!getRevision) continue;
    const existing = next[existingIndex];
    const currentRevision = existing ? getRevision(existing) : undefined;
    const incomingRevision = getRevision(item);
    if (incomingRevision && (!currentRevision || incomingRevision > currentRevision)) {
      next[existingIndex] = item;
      changed = true;
    }
  }

  return changed ? next : current;
}

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
  shouldAcceptServerItem: (item: T) => boolean = () => true,
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
  const shouldAcceptServerItemRef = useRef(shouldAcceptServerItem);
  shouldAcceptServerItemRef.current = shouldAcceptServerItem;

  useEffect(() => {
    const id = getIdRef.current;
    const acceptedServerItems = serverItems.filter(shouldAcceptServerItemRef.current);
    const additions = acceptedServerItems.filter((item) => !seenIds.current.has(id(item)));

    for (const item of serverItems) {
      seenIds.current.add(id(item));
    }

    setItems((current) => {
      const revision = getRevisionRef.current;
      const additionIds = new Set(additions.map(id));
      const next = reconcileRevisionedItems(current, acceptedServerItems, id, revision, (item) =>
        additionIds.has(id(item)),
      );
      return next === current || !sortRef.current ? next : sortRef.current(next);
    });
  }, [serverItems]);

  return [items, setItems];
}
