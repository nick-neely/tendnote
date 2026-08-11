import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");
const migration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0045_saved_items.sql"),
  "utf8",
);
const ownershipMigration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0067_household_native_saved_items.sql"),
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

  it("proves the single-record visible read before returning the row", () => {
    // The predicate narrows; the proof authorizes. Without this a row that
    // passed a stale-by-a-request SQL filter would come back unchecked, and the
    // record's ownership form, lifecycle, and sensitivity - none of which SQL
    // evaluates - would never be consulted (ADR 0219).
    expect(source).toContain("provenVisibleRecord");
    expect(source).toContain("ownership: row.ownership");
    // Null on refusal, indistinguishable from a Saved Item that is not there.
    expect(source).toContain("proven ? savedItemSchema.parse(proven) : null");
  });

  it("guards the household-native write by version and ownership in one statement", () => {
    // Comparing the version outside the UPDATE would leave a read-then-write gap
    // two members could both pass, which is the last-write-wins this domain
    // refuses. The ownership clause keeps the versioned path off member-owned
    // rows entirely.
    expect(source).toContain("async updateHouseholdNativeSavedItem(input)");
    expect(source).toContain('eq(savedItems.ownership, "household_native")');
    expect(source).toContain("eq(savedItems.version, input.expectedVersion)");
    expect(source).toMatch(/version: sql`\$\{savedItems\.version\} \+ 1`/);
  });

  it("matches a household-native audit trail on a null owner rather than by equality", () => {
    // `owner_user_id = NULL` is never true, so a workspace-owned item's own
    // history would be invisible to it without the null-aware key.
    expect(source).toContain("isNull(savedItemEvents.ownerUserId)");
    expect(source).toContain("ownerEventKey(");
  });

  it("ships the workspace-ownership columns and their constraint in the descriptive migration", () => {
    expect(ownershipMigration).toContain('ALTER TABLE "saved_items" ALTER COLUMN "owner_user_id"');
    expect(ownershipMigration).toContain("DROP NOT NULL");
    expect(ownershipMigration).toContain('ADD COLUMN "ownership"');
    expect(ownershipMigration).toContain('ADD COLUMN "version"');
    // The constraint is what stops an adapter inventing a third ownership form:
    // a member-owned row names its member, a household-native row names none and
    // is whole-household visible with its creator recorded (ADR 0214).
    expect(ownershipMigration).toContain('CONSTRAINT "saved_items_ownership_check"');
    expect(ownershipMigration).toContain(`"saved_items"."owner_user_id" is null`);
    expect(ownershipMigration).toContain(`"saved_items"."scope" = 'household'`);
    expect(ownershipMigration).toContain(`"saved_items"."created_by_user_id" is not null`);
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
