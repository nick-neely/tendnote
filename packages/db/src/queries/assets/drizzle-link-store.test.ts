import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's convention: the drizzle store
// has no live-DB harness, so we pin the production behaviors the in-memory store
// cannot exercise for it. The link seam tests (links.test.ts) are the behavioral
// contract; these keep the drizzle implementation from quietly dropping its side.
const source = readFileSync(join(import.meta.dirname, "drizzle-link-store.ts"), "utf8");

describe("asset link drizzle store guards (#202)", () => {
  it("creates asset links idempotently against the owner-scoped unique triple", () => {
    // Owner-scoped on purpose: a global (from, to, relation) triple would let
    // one member's add resolve or revive a co-member's review-gated row.
    expect(source).toContain("onConflictDoNothing");
    expect(source).toContain("assetLinks.ownerUserId,");
    expect(source).toMatch(
      /assetLinks\.ownerUserId,\s+assetLinks\.fromAssetId,\s+assetLinks\.toAssetId,\s+assetLinks\.relation,/,
    );
  });

  it("creates person links idempotently against the owner-scoped unique triple", () => {
    expect(source).toMatch(
      /assetPersonLinks\.ownerUserId,\s+assetPersonLinks\.assetId,\s+assetPersonLinks\.personId,\s+assetPersonLinks\.relation,/,
    );
  });

  it("owner-keys the idempotent-return lookups so no foreign row is ever returned", () => {
    expect(source).toContain("eq(assetLinks.ownerUserId, parsed.ownerUserId)");
    expect(source).toContain("eq(assetPersonLinks.ownerUserId, parsed.ownerUserId)");
  });

  it("owner-keys every read-by-id, update, and delete", () => {
    const ownerKeyedLinks =
      source.split("eq(assetLinks.ownerUserId, input.ownerUserId)").length - 1;
    expect(ownerKeyedLinks).toBeGreaterThanOrEqual(3);
    const ownerKeyedPersonLinks =
      source.split("eq(assetPersonLinks.ownerUserId, input.ownerUserId)").length - 1;
    expect(ownerKeyedPersonLinks).toBeGreaterThanOrEqual(2);
  });

  it("validates status patches through the defaults-free update schema", () => {
    expect(source).toContain("assetLinkUpdateSchema.parse(input.patch)");
  });

  it("reads links for an asset in both directions, oldest-first with an id tiebreak", () => {
    expect(source).toContain(
      "or(eq(assetLinks.fromAssetId, input.assetId), eq(assetLinks.toAssetId, input.assetId))",
    );
    expect(source).toContain("asc(assetLinks.createdAt), asc(assetLinks.id)");
    expect(source).toContain("asc(assetPersonLinks.createdAt), asc(assetPersonLinks.id)");
  });
});
