import { describe, expect, it } from "vitest";
import {
  clearAllLocalComposerDrafts,
  clearLocalComposerDraft,
  consumeLocalEveDraftSubmission,
  loadLocalComposerDraft,
  requestLocalEveDraftSubmission,
  saveLocalComposerDraft,
} from "./local-composer-draft";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("local composer drafts", () => {
  it("restores one unsaved draft per surface for at most 24 hours", () => {
    const storage = new MemoryStorage();
    const now = Date.parse("2026-07-21T12:00:00Z");
    saveLocalComposerDraft(storage, "owner-1", "capture", "Keep this", now);
    saveLocalComposerDraft(storage, "owner-1", "eve", "Ask this", now);

    expect(
      loadLocalComposerDraft(storage, "owner-1", "capture", now + 23 * 60 * 60 * 1000),
    ).toEqual({
      restored: true,
      value: "Keep this",
    });
    expect(loadLocalComposerDraft(storage, "owner-1", "eve", now + 23 * 60 * 60 * 1000)).toEqual({
      restored: true,
      value: "Ask this",
    });
    expect(
      loadLocalComposerDraft(storage, "owner-1", "capture", now + 24 * 60 * 60 * 1000 + 1),
    ).toEqual({
      restored: false,
      value: "",
    });
  });

  it("never restores another owner's local draft", () => {
    const storage = new MemoryStorage();
    saveLocalComposerDraft(storage, "owner-1", "eve", "Private question", 1);

    expect(loadLocalComposerDraft(storage, "owner-2", "eve", 2)).toEqual({
      restored: false,
      value: "",
    });
  });

  it("hands an explicit Today submission to Eve once for the same owner", () => {
    const storage = new MemoryStorage();
    requestLocalEveDraftSubmission(storage, "owner-1", "What is due?");

    expect(consumeLocalEveDraftSubmission(storage, "owner-2")).toBe(false);
    expect(consumeLocalEveDraftSubmission(storage, "owner-1")).toBe(true);
    expect(consumeLocalEveDraftSubmission(storage, "owner-1")).toBe(false);
    expect(loadLocalComposerDraft(storage, "owner-1", "eve", Date.now())).toMatchObject({
      restored: true,
      value: "What is due?",
    });
  });

  it("clears empty, discarded, successful, and signed-out drafts", () => {
    const storage = new MemoryStorage();
    saveLocalComposerDraft(storage, "owner-1", "capture", "Capture", 1);
    clearLocalComposerDraft(storage, "owner-1", "capture");
    expect(loadLocalComposerDraft(storage, "owner-1", "capture", 2)).toEqual({
      restored: false,
      value: "",
    });

    saveLocalComposerDraft(storage, "owner-1", "capture", "Capture", 3);
    saveLocalComposerDraft(storage, "owner-2", "eve", "Question", 3);
    clearAllLocalComposerDrafts(storage);
    expect(storage.length).toBe(0);
  });

  it("fails closed for malformed or future-dated local data", () => {
    const storage = new MemoryStorage();
    storage.setItem("tendnote:composer-draft:v1:owner-1:capture", "not-json");
    expect(loadLocalComposerDraft(storage, "owner-1", "capture", 10)).toEqual({
      restored: false,
      value: "",
    });
    saveLocalComposerDraft(storage, "owner-1", "eve", "Future", 100);
    expect(loadLocalComposerDraft(storage, "owner-1", "eve", 10)).toEqual({
      restored: false,
      value: "",
    });
  });
});
