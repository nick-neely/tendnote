import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("audit log retention Drizzle store contract", () => {
  it("selects each policy partition through the created-at index", () => {
    expect(source).toContain("input.cutoffs.map");
    expect(source).toContain("inArray(auditLog.id, options.candidateIds)");
    expect(source).toContain("gte(auditLog.createdAt, cutoff.createdAtAfter)");
    expect(source).toContain("lte(auditLog.createdAt, cutoff.createdAtBefore)");
    expect(source).toContain("orderBy(asc(auditLog.createdAt), asc(auditLog.id))");
    expect(source).toContain("Promise.all");
    expect(source).toContain(".slice(0, input.limit)");
    expect(source).toContain(".limit(input.limit)");
    expect(source).not.toContain("metadataJson");
    expect(source).not.toContain("make_interval");
    expect(source).not.toContain("case ");
  });

  it("rechecks the timestamp while deleting one row", () => {
    expect(source).toContain("eq(auditLog.id, input.id)");
    expect(source).toContain("lte(auditLog.createdAt, input.before)");
    expect(source).toContain(".returning({ id: auditLog.id })");
  });
});
