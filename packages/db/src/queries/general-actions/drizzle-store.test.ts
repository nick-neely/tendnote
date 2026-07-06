import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's migration-shape test convention:
// the drizzle store has no live-DB harness, so we pin the two production behaviors
// the in-memory store cannot exercise for it — the defaults-free update parse and
// the surfacing-time ordering. A revert of either fails here.
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("general actions drizzle store guards", () => {
  it("validates update patches with the defaults-free schema, not a base partial", () => {
    // `generalActionSchema.partial().parse(patch)` injects `.default()` values for
    // absent keys and silently wipes columns (dueAt, notes, links, scope) on every
    // update. The store must use the defaults-free `generalActionUpdateSchema`.
    expect(source).toContain("generalActionUpdateSchema.parse(input.patch)");
    expect(source).not.toContain("generalActionSchema.partial(");
  });

  it("orders listings by surfacing time (coalesce(deferUntil, dueAt) nulls last)", () => {
    // Must match the in-memory store's `surfacingTime` so both back the surface
    // identically (see the store contract).
    expect(source).toContain("coalesce(");
    expect(source).toContain("generalActions.deferUntil");
    expect(source).toContain("generalActions.dueAt");
    expect(source).toContain("nulls last");
  });
});
