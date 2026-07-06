import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's migration-shape test convention:
// the drizzle store has no live-DB harness, so we pin the two production behaviors
// the in-memory store cannot exercise for it — the defaults-free update parse and
// the sortOrder-then-name ordering. A revert of either fails here.
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("general action area drizzle store guards", () => {
  it("validates update patches with the defaults-free schema, not a base partial", () => {
    // `generalActionAreaSchema.partial().parse(patch)` injects `.default()` values
    // for absent keys and would clear `archivedAt` on a plain rename. The store must
    // use the defaults-free `generalActionAreaUpdateSchema`.
    expect(source).toContain("generalActionAreaUpdateSchema.parse(input.patch)");
    expect(source).not.toContain("generalActionAreaSchema.partial(");
  });

  it("orders listings by sortOrder then name, matching the in-memory store", () => {
    expect(source).toContain("asc(generalActionAreas.sortOrder)");
    expect(source).toContain("asc(generalActionAreas.name)");
  });

  it("excludes archived areas unless includeArchived is set", () => {
    expect(source).toContain("isNull(generalActionAreas.archivedAt)");
    expect(source).toContain("input.includeArchived === true");
  });

  it("seeds defaults with an atomic on-conflict-do-nothing multi-row insert", () => {
    // Seeding must be race-safe against the partial unique index rather than a
    // per-row loop that can partially fail or double-seed.
    expect(source).toContain("onConflictDoNothing()");
  });
});
