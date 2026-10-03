import { describe, expect, it, vi } from "vitest";

const failure = vi.hoisted(() => ({ error: new Error("unset") as unknown }));

vi.mock("../client", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => {
          throw failure.error;
        },
      }),
    }),
  }),
  withoutDatabaseTransaction: <T>(fn: () => Promise<T>) => fn(),
}));

import { recordModelUsage } from "./usage-ledger";

const usage = {
  accountId: "owner-1",
  modelId: "google/gemini-3.7-flash",
  costCategory: "interactive" as const,
  inputTokens: 3,
  outputTokens: 2,
  costMicroUsd: 5,
};

describe("recordModelUsage", () => {
  it.each([
    [
      "a database error code",
      Object.assign(new Error("failed query: owner-1"), { cause: { code: "23503" } }),
      "23503",
    ],
    ["an error name", new TypeError("owner-1"), "TypeError"],
    ["nothing it can name", "owner-1", "unknown"],
  ])("never fails the call, and logs only %s", async (_, error, reason) => {
    failure.error = error;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(recordModelUsage(usage)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith("usage-ledger: could not record a model call", {
      modelId: "google/gemini-3.7-flash",
      costCategory: "interactive",
      reason,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("owner-1");
    warn.mockRestore();
  });
});
