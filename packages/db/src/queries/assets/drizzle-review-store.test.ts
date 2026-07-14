import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's convention: the drizzle store
// has no live-DB harness, so we pin the production behaviors the in-memory store
// cannot exercise for it. The review lifecycle tests (review.test.ts) are the
// behavioral contract; these keep the drizzle implementation from quietly
// dropping its side of it.
const source = readFileSync(join(import.meta.dirname, "drizzle-review-store.ts"), "utf8");
const assetSource = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("asset review drizzle store guards (#198)", () => {
  it("validates memory update patches with the defaults-free schema", () => {
    expect(source).toContain("assetMemoryUpdateSchema.parse(input.patch)");
    expect(source).not.toContain("assetMemorySchema.partial(");
  });

  it("filters visible memory reads with the shared scope predicate, active-only", () => {
    // Per-record filtering through the one shared predicate (ADR 0153), with the
    // asset_memory record kind and the `am` alias; review state never rides a
    // visible read.
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain('recordKind: "asset_memory"');
    expect(source).toContain('tableAlias: "am"');
    expect(source).toContain('alias(assetMemories, "am")');
    expect(source).toContain('eq(visibleMemories.status, "active")');
  });

  it("owner-keys every memory and group read/write", () => {
    expect(source).toContain("assetMemories.ownerUserId, input.ownerUserId");
    expect(source).toContain("assetReviewGroups.ownerUserId, input.ownerUserId");
  });

  it("lists pending groups by a suggested anchor or a suggested memory", () => {
    expect(source).toContain('eq(assets.status, "suggested")');
    expect(source).toContain('eq(assetMemories.status, "suggested")');
    expect(source).toContain("or(pendingAnchor, pendingMemory)");
  });

  it("orders memories oldest-first with an id tiebreak, matching the in-memory store", () => {
    expect(source).toContain("asc(assetMemories.createdAt), asc(assetMemories.id)");
  });
});

describe("asset drizzle store review-status guards (#198)", () => {
  it("filters every scope-visible asset read to durable statuses", () => {
    // A suggested proposal (or dismissed husk) must never reach a visible read —
    // not a member's, not the owner's own Assets ledger (ADRs 0151, 0152, 0153).
    expect(assetSource).toContain("DURABLE_ASSET_STATUSES");
    const visibleReads = assetSource.split("durableVisibleStatus,").length - 1;
    expect(visibleReads).toBeGreaterThanOrEqual(2);
  });
});
