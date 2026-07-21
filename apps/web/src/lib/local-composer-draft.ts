"use client";

import { useCallback, useEffect, useState } from "react";

export type LocalComposerSurface = "capture" | "eve";

const DRAFT_PREFIX = "tendnote:composer-draft:v1:";
const EVE_SUBMIT_PREFIX = "tendnote:composer-submit:v1:";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type StoredDraft = {
  savedAt: number;
  value: string;
  version: 1;
};

function draftKey(ownerUserId: string, surface: LocalComposerSurface) {
  return `${DRAFT_PREFIX}${encodeURIComponent(ownerUserId)}:${surface}`;
}

export function loadLocalComposerDraft(
  storage: Storage,
  ownerUserId: string,
  surface: LocalComposerSurface,
  now = Date.now(),
): { restored: boolean; value: string } {
  const key = draftKey(ownerUserId, surface);
  try {
    const raw = storage.getItem(key);
    if (!raw) return { restored: false, value: "" };
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    const age = now - (parsed.savedAt ?? Number.NaN);
    if (
      parsed.version !== 1 ||
      typeof parsed.value !== "string" ||
      !parsed.value.trim() ||
      !Number.isFinite(age) ||
      age < 0 ||
      age >= DRAFT_TTL_MS
    ) {
      storage.removeItem(key);
      return { restored: false, value: "" };
    }
    return { restored: true, value: parsed.value };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // A blocked storage area behaves like no restorable draft.
    }
    return { restored: false, value: "" };
  }
}

export function saveLocalComposerDraft(
  storage: Storage,
  ownerUserId: string,
  surface: LocalComposerSurface,
  value: string,
  now = Date.now(),
) {
  if (!value.trim()) {
    clearLocalComposerDraft(storage, ownerUserId, surface);
    return;
  }
  const draft: StoredDraft = { savedAt: now, value, version: 1 };
  storage.setItem(draftKey(ownerUserId, surface), JSON.stringify(draft));
}

export function clearLocalComposerDraft(
  storage: Storage,
  ownerUserId: string,
  surface: LocalComposerSurface,
) {
  storage.removeItem(draftKey(ownerUserId, surface));
}

export function clearAllLocalComposerDrafts(storage: Storage) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string =>
      Boolean(key?.startsWith(DRAFT_PREFIX) || key?.startsWith(EVE_SUBMIT_PREFIX)),
  );
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Sign-out and successful submission must continue if storage is blocked.
    }
  }
}

export function requestLocalEveDraftSubmission(
  storage: Storage,
  ownerUserId: string,
  value: string,
) {
  saveLocalComposerDraft(storage, ownerUserId, "eve", value);
  storage.setItem(`${EVE_SUBMIT_PREFIX}${encodeURIComponent(ownerUserId)}`, "1");
}

export function consumeLocalEveDraftSubmission(storage: Storage, ownerUserId: string): boolean {
  const key = `${EVE_SUBMIT_PREFIX}${encodeURIComponent(ownerUserId)}`;
  try {
    const requested = storage.getItem(key) === "1";
    storage.removeItem(key);
    return requested;
  } catch {
    return false;
  }
}

export function useLocalComposerDraft(ownerUserId: string, surface: LocalComposerSurface) {
  const [value, setValue] = useState("");
  const [restored, setRestored] = useState(false);
  const [hydratedIdentity, setHydratedIdentity] = useState<string | null>(null);
  const identity = `${ownerUserId}:${surface}`;

  useEffect(() => {
    try {
      const loaded = loadLocalComposerDraft(window.localStorage, ownerUserId, surface);
      setValue(loaded.value);
      setRestored(loaded.restored);
    } finally {
      setHydratedIdentity(identity);
    }
  }, [identity, ownerUserId, surface]);

  useEffect(() => {
    if (hydratedIdentity !== identity) return;
    try {
      saveLocalComposerDraft(window.localStorage, ownerUserId, surface, value);
    } catch {
      // Device-local drafts are a best-effort convenience, never durable truth.
    }
  }, [hydratedIdentity, identity, ownerUserId, surface, value]);

  const clear = useCallback(() => {
    setValue("");
    setRestored(false);
    try {
      clearLocalComposerDraft(window.localStorage, ownerUserId, surface);
    } catch {
      // The visible input still clears if storage is unavailable.
    }
  }, [ownerUserId, surface]);

  const hydrated = hydratedIdentity === identity;
  return {
    clear,
    hydrated,
    restored: hydrated ? restored : false,
    setValue,
    value: hydrated ? value : "",
  };
}
