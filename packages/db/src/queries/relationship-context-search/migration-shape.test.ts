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

  it("keeps production memory search policy in the SQL query", () => {
    expect(drizzleStore).toContain("m.status = 'approved'");
    expect(drizzleStore).toContain("m.sensitivity <> 'restricted'");
    expect(drizzleStore).toContain("ts_rank_cd(m.search_vector, search_query.query)");
    expect(drizzleStore).toContain("m.importance::float8 * 0.01");
  });
});
