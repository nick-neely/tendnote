import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard (this package's migration-shape convention): the follow-up
// drizzle store has no live-DB harness, so pin the update-parse behavior the
// in-memory store cannot exercise for it. `followupSchema.partial().parse(patch)`
// injects `.default()` values for absent keys and resets status/scope/household on
// every update; the store must use the defaults-free `followupUpdateSchema`.
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("followups drizzle store guards", () => {
  it("validates update patches with the defaults-free schema, not a base partial", () => {
    expect(source).toContain("followupUpdateSchema.parse(input.patch)");
    expect(source).not.toContain("followupSchema.partial(");
  });
});
