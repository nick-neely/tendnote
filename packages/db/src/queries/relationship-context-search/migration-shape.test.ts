import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0003_cultured_falcon.sql"),
  "utf8",
);

describe("exact recall migration shape", () => {
  it("adds durable people full-text support with a GIN index", () => {
    expect(migration).toContain('ALTER TABLE "people" ADD COLUMN "search_vector" "tsvector"');
    expect(migration).toContain("GENERATED ALWAYS AS");
    expect(migration).toContain('CREATE INDEX "people_search_vector_idx"');
    expect(migration).toContain("USING gin");
  });
});
