import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's convention: the drizzle store
// has no live-DB harness, so we pin the production behaviors the in-memory store
// cannot exercise for it. The bridge tests (action-links.test.ts) are the
// behavioral contract; these keep the drizzle implementation from quietly
// dropping its side of it.
const source = readFileSync(join(import.meta.dirname, "drizzle-action-link-store.ts"), "utf8");

describe("general action asset link drizzle store guards (#199)", () => {
  it("creates links idempotently against the unique (action, asset) pair", () => {
    expect(source).toContain("onConflictDoNothing");
    expect(source).toContain("generalActionAssets.generalActionId, generalActionAssets.assetId");
  });

  it("owner-keys the re-point and the delete", () => {
    const ownerKeyed =
      source.split("generalActionAssets.ownerUserId, input.ownerUserId").length - 1;
    expect(ownerKeyed).toBeGreaterThanOrEqual(2);
  });

  it("collapses a re-point that would collide with an existing pair", () => {
    // The stale row is deleted rather than duplicated onto the target.
    expect(source).toContain("db.delete(generalActionAssets)");
    expect(source).toContain("eq(generalActionAssets.assetId, input.toAssetId)");
  });

  it("orders link reads oldest-first with an id tiebreak, matching the in-memory store", () => {
    expect(source).toContain("asc(generalActionAssets.createdAt), asc(generalActionAssets.id)");
  });
});
