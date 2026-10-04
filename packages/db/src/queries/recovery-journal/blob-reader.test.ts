import { recoveryJournalEntry } from "@tendnote/domain";
import { RETENTION } from "@tendnote/domain/retention";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { del, get, head, list, put } = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ del, get, head, list, put }));

import { blobRecoveryJournalStore, sweepDeletionRecords } from "./blob-reader";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T00:00:00.000Z");

function recordedDaysAgo(days: number) {
  return recoveryJournalEntry({
    kind: "deletion",
    subjectKind: "account",
    subjectId: `user_${days}`,
    at: new Date(NOW.getTime() - days * DAY_MS),
  }).pathname;
}

beforeEach(() => vi.resetAllMocks());

describe("blobRecoveryJournalStore", () => {
  it("lists a prefix to its last page", async () => {
    list
      .mockResolvedValueOnce({ blobs: [{ pathname: "a" }], hasMore: true, cursor: "c1" })
      .mockResolvedValueOnce({ blobs: [{ pathname: "b" }], hasMore: false });

    await expect(blobRecoveryJournalStore.list("journal/deletion/")).resolves.toEqual(["a", "b"]);
    expect(list).toHaveBeenLastCalledWith({
      prefix: "journal/deletion/",
      cursor: "c1",
      limit: 1000,
    });
  });

  it("reads a body from origin, never from the cache", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: new Response("{}").body });

    await expect(blobRecoveryJournalStore.read("journal/x.json")).resolves.toEqual({
      pathname: "journal/x.json",
      body: "{}",
    });
    expect(get).toHaveBeenCalledWith("journal/x.json", { access: "private", useCache: false });
  });

  it("reads a missing entry as null", async () => {
    get.mockResolvedValue(null);

    await expect(blobRecoveryJournalStore.read("journal/x.json")).resolves.toBeNull();
  });
});

describe("sweepDeletionRecords", () => {
  const retention = RETENTION.deletionRecord.days;

  it("deletes records past retention and stops at the first one still kept", async () => {
    const expired = [recordedDaysAgo(retention + 2), recordedDaysAgo(retention)];
    const kept = [recordedDaysAgo(retention - 1), recordedDaysAgo(retention + 5)];
    list.mockResolvedValue({ blobs: [...expired, ...kept].map((pathname) => ({ pathname })) });

    await expect(sweepDeletionRecords({ now: NOW })).resolves.toEqual({
      deleted: 2,
      failed: false,
    });
    expect(list).toHaveBeenCalledWith({ prefix: "journal/deletion/", limit: 100 });
    expect(del).toHaveBeenCalledWith(expired);
  });

  it("reports a failure instead of throwing, for the next pass to retry", async () => {
    list.mockRejectedValue(new Error("store unreachable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(sweepDeletionRecords({ now: NOW })).resolves.toEqual({
      deleted: 0,
      failed: true,
    });
  });
});
