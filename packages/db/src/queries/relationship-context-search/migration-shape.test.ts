import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const peopleMigration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0003_cultured_falcon.sql"),
  "utf8",
);
const memoriesMigration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0004_sharp_vargas.sql"),
  "utf8",
);
const sourceRecordsMigration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0005_deep_big_bertha.sql"),
  "utf8",
);
const drizzleStore = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("exact recall migration shape", () => {
  it("adds durable people full-text support with a GIN index", () => {
    expect(peopleMigration).toContain('ALTER TABLE "people" ADD COLUMN "search_vector" "tsvector"');
    expect(peopleMigration).toContain("GENERATED ALWAYS AS");
    expect(peopleMigration).toContain('CREATE INDEX "people_search_vector_idx"');
    expect(peopleMigration).toContain("USING gin");
  });

  it("adds durable memory full-text support with a GIN index", () => {
    expect(memoriesMigration).toContain(
      'ALTER TABLE "memories" ADD COLUMN "search_vector" "tsvector"',
    );
    expect(memoriesMigration).toContain("GENERATED ALWAYS AS");
    expect(memoriesMigration).toContain('CREATE INDEX "memories_search_vector_idx"');
    expect(memoriesMigration).toContain("USING gin");
  });

  it("adds durable source-record full-text support with a GIN index", () => {
    expect(sourceRecordsMigration).toContain(
      'ALTER TABLE "source_records" ADD COLUMN "search_vector" "tsvector"',
    );
    expect(sourceRecordsMigration).toContain("GENERATED ALWAYS AS");
    expect(sourceRecordsMigration).toContain('CREATE INDEX "source_records_search_vector_idx"');
    expect(sourceRecordsMigration).toContain("USING gin");
  });

  it("keeps production memory search policy in the SQL query", () => {
    expect(drizzleStore).toContain("m.status = 'approved'");
    expect(drizzleStore).toContain("m.sensitivity <> 'restricted'");
    expect(drizzleStore).toContain("ts_rank_cd(m.search_vector, search_query.query)");
    expect(drizzleStore).toContain("m.importance::float8 * 0.01");
    expect(drizzleStore).toContain("extract(epoch from m.updated_at)");
  });

  it("keeps production source-record search policy in the SQL query", () => {
    expect(drizzleStore).toContain("sr.status = 'active'");
    expect(drizzleStore).toContain("sr.sensitivity <> 'restricted'");
    expect(drizzleStore).toContain("left join lateral");
    expect(drizzleStore).toContain("p.owner_user_id = ");
    expect(drizzleStore).toContain("ts_rank_cd(sr.search_vector, search_query.query)");
    expect(drizzleStore).toContain("sr.importance::float8 * 0.01");
    expect(drizzleStore).toContain("extract(epoch from sr.updated_at)");
    expect(drizzleStore).not.toContain("raw_content @@");
  });

  it("keeps mixed SQL ranking and limit global across the union", () => {
    expect(drizzleStore).toContain("union all");
    expect(drizzleStore).toContain(") mixed_results");
    expect(drizzleStore).toContain("order by rank desc, label asc, record_id asc");
    expect(drizzleStore).toContain("limit ");
    expect(drizzleStore).toContain("extract(epoch from p.updated_at)");
  });
});
