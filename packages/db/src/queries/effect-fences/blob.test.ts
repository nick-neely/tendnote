import { effectFenceEntry } from "@tendnote/domain";
import { RETENTION } from "@tendnote/domain/retention";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { del, head, list, put } = vi.hoisted(() => ({
  del: vi.fn(),
  head: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ del, head, list, put }));

import { blobEffectFences, sweepEffectFences } from "./blob";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T00:00:00.000Z");

function fencedDaysAgo(effect: "email" | "export", days: number, key = `key-${days}`) {
  return effectFenceEntry({ effect, key, at: new Date(NOW.getTime() - days * DAY_MS) }).pathname;
}

function listing(byPrefix: Record<string, string[]>) {
  list.mockImplementation(async ({ prefix, limit }: { prefix: string; limit: number }) => ({
    blobs: (byPrefix[prefix] ?? []).slice(0, limit).map((pathname) => ({ pathname })),
  }));
}

beforeEach(() => vi.resetAllMocks());

describe("blobEffectFences", () => {
  it("writes one private, never-overwritten blob under the fence prefix", async () => {
    const fence = { effect: "email" as const, key: "refund:r_1", at: NOW };
    const entry = effectFenceEntry(fence);

    await blobEffectFences.write(fence);

    expect(put).toHaveBeenCalledWith(entry.pathname, entry.body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
    });
    expect(entry.pathname.startsWith("fence/email/")).toBe(true);
  });
});

describe("sweepEffectFences", () => {
  const retention = RETENTION.effectFence.days;

  it("deletes fences past retention and stops at the first one still kept", async () => {
    const oldEmail = fencedDaysAgo("email", retention + 2);
    const dueEmail = fencedDaysAgo("email", retention);
    const keptEmail = fencedDaysAgo("email", retention - 1);
    const oldExport = fencedDaysAgo("export", retention + 1);
    listing({
      "fence/email/": [oldEmail, dueEmail, keptEmail],
      "fence/export/": [oldExport],
    });

    await expect(sweepEffectFences({ now: NOW })).resolves.toEqual({ deleted: 3, failed: false });
    expect(del).toHaveBeenCalledWith([oldEmail, dueEmail]);
    expect(del).toHaveBeenCalledWith([oldExport]);
  });

  it("deletes nothing while every fence is inside retention", async () => {
    listing({ "fence/email/": [fencedDaysAgo("email", 1)] });

    await expect(sweepEffectFences({ now: NOW })).resolves.toEqual({ deleted: 0, failed: false });
    expect(del).not.toHaveBeenCalled();
  });

  it("spends one budget across both effects", async () => {
    listing({
      "fence/email/": [
        fencedDaysAgo("email", retention + 3),
        fencedDaysAgo("email", retention + 2),
      ],
      "fence/export/": [fencedDaysAgo("export", retention + 1)],
    });

    await expect(sweepEffectFences({ now: NOW, limit: 2 })).resolves.toEqual({
      deleted: 2,
      failed: false,
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("reports a failure for the next pass instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    list.mockRejectedValue(new Error("No token found"));

    await expect(sweepEffectFences({ now: NOW })).resolves.toEqual({ deleted: 0, failed: true });
    expect(warn).toHaveBeenCalledOnce();
  });
});
