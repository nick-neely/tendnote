import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");
const migration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0045_saved_items.sql"),
  "utf8",
);

describe("Saved Item Drizzle store contract", () => {
  it("owner-keys direct reads and mutations and uses shared visibility for caller reads", () => {
    expect(source).toContain("eq(savedItems.ownerUserId, input.ownerUserId)");
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain('tableAlias: "si"');
    expect(source).toContain('recordKind: "saved_item"');
  });

  it("uses a defaults-free update schema and idempotent outcome linking", () => {
    expect(source).toContain("savedItemUpdateSchema.parse(input.patch)");
    expect(source).toContain(".onConflictDoNothing({ target: savedItemOutcomes.idempotencyKey })");
  });

  it("defaults exact retrieval to active while requiring explicit archive inclusion", () => {
    expect(source).toContain('eq(visibleSavedItems.status, "active")');
    expect(source).toContain('inArray(visibleSavedItems.status, ["active", "archived"])');
  });

  it("ships source-grounded tables and semantic/visibility enums in the descriptive migration", () => {
    expect(migration).toContain('CREATE TABLE "saved_items"');
    expect(migration).toContain("ON DELETE restrict");
    expect(migration).toContain("ADD VALUE 'saved_item'");
    expect(migration).toContain("ADD VALUE 'saved_context'");
  });

  it("deletes unique source evidence and derived semantic material in one owner-scoped transaction", () => {
    expect(source).toContain("async deleteUniqueSavedItemSourceEvidence(input)");
    expect(source).toContain("buildSourceRecordDependenciesQuery(input)");
    expect(source).toContain("'memory'::text");
    expect(source).toContain("'general_action'::text");
    expect(source).toContain("'followup'::text");
    expect(source).toContain("'asset_memory'::text");
    expect(source).toContain("relationshipContextEmbeddings.ownerUserId");
    expect(source).toContain("relationshipContextEmbeddingJobs.ownerUserId");
    expect(source).toContain('action: "saved_item.source_evidence_deleted"');
    expect(source).toContain(".delete(sourceRecords)");
  });
});
