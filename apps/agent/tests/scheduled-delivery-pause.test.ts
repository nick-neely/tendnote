import type { UsageNotices } from "@tendnote/domain/usage-bounds";
import { describe, expect, it, vi } from "vitest";
import { createScheduledDeliveryPause } from "../agent/lib/scheduled-delivery-pause";

const normal = { state: "normal" } as const;
const paused = { state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } } as const;

function notices(background: UsageNotices["background"]): UsageNotices {
  return { eve: normal, search: normal, background, webSearch: normal };
}

describe("createScheduledDeliveryPause", () => {
  it("skips the delivery for an owner whose background work is paused", async () => {
    const isPaused = createScheduledDeliveryPause(async ({ userId }) =>
      notices(userId === "owner-paused" ? paused : normal),
    );

    await expect(isPaused("owner-paused")).resolves.toBe(true);
    await expect(isPaused("owner-normal")).resolves.toBe(false);
  });

  it("reads each owner's usage once per tick", async () => {
    const read = vi.fn(async () => notices(paused));
    const isPaused = createScheduledDeliveryPause(read);

    await Promise.all([isPaused("owner-1"), isPaused("owner-1"), isPaused("owner-1")]);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("delivers when the usage read fails, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const isPaused = createScheduledDeliveryPause(async () => {
      throw new Error("database unavailable");
    });

    await expect(isPaused("owner-1")).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/scheduled/));
    warn.mockRestore();
  });
});
