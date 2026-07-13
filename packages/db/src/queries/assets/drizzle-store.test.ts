import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's migration-shape test convention:
// the drizzle store has no live-DB harness, so we pin the production behaviors the
// in-memory store cannot exercise for it — the defaults-free update parse, the
// shared scope predicate, and the name-ordering contract. A revert of any fails here.
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

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
});
