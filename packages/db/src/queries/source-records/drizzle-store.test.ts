import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("Source Record Drizzle store contract", () => {
  it("keeps the owner-keyed evidence read owner-keyed", () => {
    // The visibility-scoped read added for household reminders sits beside this
    // one; it must not become a replacement for it. Owner-keyed reads are what
    // the capture and resolution paths rely on to stay inside one person's data.
    expect(source).toContain("async getSourceRecord(input)");
    expect(source).toContain("eq(sourceRecords.ownerUserId, input.ownerUserId)");
  });

  it("proves the visibility-scoped evidence read before returning the row", () => {
    // Predicate narrows, proof authorizes - the same two steps every scoped
    // single-record read takes (ADR 0219). Without the proof, evidence that
    // passed a stale SQL filter would be handed to a member whose access ended
    // between the page render and the read.
    expect(source).toContain("async getVisibleSourceRecord(input)");
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain('tableAlias: "sr"');
    expect(source).toContain('recordKind: "source_record"');
    expect(source).toContain("provenVisibleRecord");
    expect(source).toContain('alias(sourceRecords, "sr")');
  });
});
