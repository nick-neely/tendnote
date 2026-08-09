import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The store has no live-DB harness, so the connection is mocked to *fail loudly*: a
// query that should never have been issued is the thing under test below.
const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error("The store issued a query it should have refused.");
  }),
}));
vi.mock("../../client", () => ({ getDb }));

const { createDrizzleAssetStore, isPersistedAssetId, selectOwnedAsset } = await import(
  "./drizzle-store"
);

// Source-assertion guard, matching this package's migration-shape test convention:
// the drizzle store has no live-DB harness, so we pin the production behaviors the
// in-memory store cannot exercise for it — the defaults-free update parse, the
// shared scope predicate, and the name-ordering contract. A revert of any fails here.
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

/**
 * A malformed id is a *denial*, not a fault (ADR 0153). Postgres compares a `uuid`
 * column against a uuid — hand it an asset's name and it raises 22P02, and the driver
 * error carries the failed SQL and its bound parameters wherever it is caught. Eve
 * reaches these reads with ids it did not read off a record, so this is the layer that
 * has to say no: an id that could never name a row names no row, exactly as the
 * in-memory twin already reports.
 */
describe("a malformed asset id is denied, never queried", () => {
  it("recognizes only a persisted uuid as an id", () => {
    expect(isPersistedAssetId("Kitchen refrigerator")).toBe(false);
    expect(isPersistedAssetId("")).toBe(false);
    expect(isPersistedAssetId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa")).toBe(false);
    expect(isPersistedAssetId("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toBe(true);
  });

  it("returns not-found from the owner-keyed read without issuing a query", async () => {
    await expect(
      selectOwnedAsset({ ownerUserId: "demo-user", assetId: "Kitchen refrigerator" }),
    ).resolves.toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns not-found from the scope-visible read without issuing a query", async () => {
    await expect(
      createDrizzleAssetStore().getVisibleAsset({
        callerUserId: "demo-user",
        assetId: "Kitchen refrigerator",
      }),
    ).resolves.toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("assets drizzle store guards", () => {
  it("validates update patches with the defaults-free schema, not a base partial", () => {
    // `assetSchema.partial().parse(patch)` would inject `.default()` values for
    // absent keys and silently wipe columns (scope, status, householdId) on every
    // update. The store must use the defaults-free `assetUpdateSchema`.
    expect(source).toContain("assetUpdateSchema.parse(input.patch)");
    expect(source).not.toContain("assetSchema.partial(");
  });

  it("filters visible reads with the shared household scope predicate", () => {
    // The visible reads must go through the one shared scope predicate so Assets
    // inherit the exact private/household/shared rules other records use — no
    // bespoke, drift-prone visibility SQL (ADR 0153). Aliased as `a` to match the
    // predicate builder.
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain('recordKind: "asset"');
    expect(source).toContain('tableAlias: "a"');
    expect(source).toContain('alias(assets, "a")');
  });

  it("proves the single-record visible read before returning the row", () => {
    // The predicate narrows; the proof authorizes. Without this call a row that
    // passed a stale-by-a-request SQL filter would be returned unchecked, and the
    // record's lifecycle, sensitivity, and exclusion facts — which SQL cannot see —
    // would never be consulted at all (ADR 0219).
    expect(source).toContain("provenVisibleRecord");
    expect(source).toContain('kind: "asset"');
    // Null on refusal, so it is indistinguishable from an asset that is not there.
    expect(source).toContain("proven ? assetSchema.parse(proven) : null");
  });

  it("orders listings by case-insensitive name with newest-first ties", () => {
    // Must match the in-memory store's `byNameThenCreated` so both back the
    // surface identically (see the store contract).
    expect(source).toContain("lower(");
    expect(source).toContain(".name");
    expect(source).toContain("createdAt");
  });

  it("owner-keys the audit trail read and write", () => {
    expect(source).toContain("assetAuditEvents.ownerUserId, input.ownerUserId");
  });

  it("hard-deletes the owned anchor and explicitly removes non-FK semantic rows", () => {
    expect(source).toContain("relationshipContextEmbeddings");
    expect(source).toContain("relationshipContextEmbeddingJobs");
    expect(source).toContain('recordKind, "asset_memory"');
    expect(source).toContain("householdRecordShares");
    expect(source).toContain('recordKind, "asset_evidence"');
    expect(source).not.toContain(
      "eq(relationshipContextEmbeddings.ownerUserId, input.ownerUserId), semanticRecord",
    );
    expect(source).toContain(".delete(assets)");
    expect(source).toContain(".transaction(");
  });
});
