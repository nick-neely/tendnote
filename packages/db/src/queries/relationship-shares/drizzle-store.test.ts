import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is no live-database harness in this package, so the guarantees that
 * live in SQL are asserted against the adapter's source. Crude, but these are
 * exactly the properties a reviewer cannot see from the sharing tests: those
 * run against the in-memory store and would keep passing if the real queries
 * leaked.
 */
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("relationship share adapter", () => {
  it("reads a person label owner-keyed, and reads only the label", () => {
    const [, labelQuery] = source.split("async getPersonDisplayLabel(input) {");
    expect(labelQuery).toBeDefined();
    const body = (labelQuery ?? "").split("},")[0] ?? "";
    expect(body).toContain("eq(people.ownerUserId, input.ownerUserId)");
    expect(body).toContain("displayName: people.displayName");
    // A `select()` with no projection would carry the birthday, relationship
    // type, closeness, and profile blurb into a share (ADR 0218).
    expect(body).not.toContain(".select()");
  });

  it("writes a visibility change owner-keyed for every family", () => {
    const [, update] = source.split("async updateRelationshipRecordVisibility(input) {");
    const body = (update ?? "").split("async getPersonDisplayLabel")[0] ?? "";
    for (const table of ["memories", "sourceRecords", "followups"]) {
      expect(body).toContain(`eq(${table}.ownerUserId, input.ownerUserId)`);
    }
  });

  it("never resolves a person for a source record", () => {
    const [, factsFn] = source.split("function sourceRecordFacts");
    const body = (factsFn ?? "").split("\n}")[0] ?? "";
    expect(body).toContain("personId: null");
  });

  it("lists share candidates through the audience rule, never private or the caller's own", () => {
    const [, list] = source.split("async listSharedRelationshipRecordCandidates(input) {");
    const body = (list ?? "").split("async updateRelationshipRecordVisibility")[0] ?? "";
    for (const alias of ["sharedMemories", "sharedFollowups"]) {
      expect(body).toContain(`ne(${alias}.scope, "private")`);
      expect(body).toContain(`ne(${alias}.ownerUserId, input.callerUserId)`);
    }
    expect(body.match(/visibleHouseholdRecordSql\(/g)).toHaveLength(2);
    // A suggestion is the assistant's guess, not the owner's memory.
    expect(body).toContain('eq(sharedMemories.status, "approved")');
  });
});
