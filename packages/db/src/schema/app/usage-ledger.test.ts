import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { usageLedger } from "./usage-ledger";

describe("usage_ledger", () => {
  it("holds only content-free columns: no prompt, reply, record, or person", () => {
    expect(Object.keys(getTableColumns(usageLedger)).sort()).toEqual([
      "callCount",
      "costCategory",
      "day",
      "inputTokens",
      "modelId",
      "outputTokens",
      "userId",
    ]);
  });
});
