"use client";

import type { GlobalRecallFilter, GlobalRecallMatchKind } from "@tendnote/domain/global-recall";

/** State shared by the phone flow and desktop palette around a recall navigation. */
export type GlobalRecallStoredState = {
  family?: GlobalRecallFilter;
  matchKind?: GlobalRecallMatchKind | "all";
  includeArchived?: boolean;
  includeRestricted?: boolean;
  query?: string;
  expanded?: string[];
  focusedKey?: string | null;
  restoreFocus?: boolean;
  scrollTop?: number;
};

const RETURN_OWNER = "tendnoteGlobalRecallOwner";
const RETURN_URL = "tendnoteGlobalRecallReturnUrl";

export function globalRecallStorageKey(ownerUserId: string) {
  return `tendnote:global-recall:${ownerUserId}`;
}

export function readGlobalRecallState(storageKey: string): GlobalRecallStoredState | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as GlobalRecallStoredState;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

/** Marks the current history entry so a result return can restore the recall surface. */
export function markGlobalRecallReturn(ownerUserId: string) {
  window.history.replaceState(
    {
      ...(window.history.state as Record<string, unknown> | null),
      [RETURN_OWNER]: ownerUserId,
      [RETURN_URL]: window.location.href,
    },
    "",
    window.location.href,
  );
}

/** Consumes a marker only when it belongs to this owner and this exact URL. */
export function consumeGlobalRecallReturn(ownerUserId: string): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  if (state?.[RETURN_OWNER] !== ownerUserId || state[RETURN_URL] !== window.location.href) {
    return false;
  }
  const { [RETURN_OWNER]: _, [RETURN_URL]: __, ...rest } = state;
  window.history.replaceState(rest, "", window.location.href);
  return true;
}
