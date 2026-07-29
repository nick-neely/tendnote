import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-assertion guard, matching this package's convention for stores with no
 * live-DB harness. The in-memory twin proves the person memory read hands back
 * approved memories of *every* sensitivity, because the split into confirmed and
 * restricted happens above the store. This pins the same contract on the Drizzle
 * adapter, which that suite cannot execute.
 */
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("memories Drizzle store parity", () => {
  it("reads every approved memory for a person, restricted included", () => {
    const read = source.slice(
      source.indexOf("async listApprovedMemoriesForPerson"),
      source.indexOf("async listMemoriesForSourceRecord"),
    );

    expect(read).toContain("eq(memories.ownerUserId, input.ownerUserId)");
    expect(read).toContain("eq(memories.personId, input.personId)");
    expect(read).toContain('eq(memories.status, "approved")');
    // A sensitivity predicate here would make restricted memories unreachable
    // even to their owner - the bug the person page's reveal exists to undo.
    expect(read).not.toContain("memories.sensitivity");
  });
});
