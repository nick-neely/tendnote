import { describe, expect, it, vi } from "vitest";

vi.mock("@tendnote/db/queries/usage-bounds", () => ({
  readEveUsageNotice: vi.fn(),
  readUsageNotices: vi.fn(),
}));

import { readBackgroundUsageForDisplay, readEveUsageForDisplay } from "./eve-usage-display";

describe("readEveUsageForDisplay", () => {
  it("passes the notice through", async () => {
    const paused = {
      state: "paused",
      recovery: { kind: "resets_on", date: "2026-11-15" },
    } as const;

    await expect(readEveUsageForDisplay("owner-1", async () => paused)).resolves.toEqual(paused);
  });

  it("shows no notice rather than failing the page when the read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      readEveUsageForDisplay("owner-1", async () => {
        throw new Error("owner-1: connection refused");
      }),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("owner-1");
    warn.mockRestore();
  });
});

describe("readBackgroundUsageForDisplay", () => {
  const normal = { state: "normal" } as const;
  const paused = { state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } } as const;

  it("passes background work's notice through", async () => {
    await expect(
      readBackgroundUsageForDisplay("owner-1", async () => ({
        eve: normal,
        search: { ...paused, state: "reduced" },
        background: paused,
        webSearch: normal,
      })),
    ).resolves.toEqual(paused);
  });

  it("shows no notice rather than failing the page when the read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      readBackgroundUsageForDisplay("owner-1", async () => {
        throw new Error("owner-1: connection refused");
      }),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("owner-1");
    warn.mockRestore();
  });
});
