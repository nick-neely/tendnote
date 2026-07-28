import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "drizzle-browse-store.ts"), "utf8");

describe("asset browse Postgres adapter", () => {
  it("keeps visibility, review status, due actions, filtering, and paging in the database", () => {
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain("asset_review_groups");
    expect(source).toContain("general_action_assets");
    expect(source).toContain("next_due_action_at");
    expect(source).toContain("next_due_action_status");
    expect(source).toContain("next_due_action_defer_until");
    expect(source).toContain(`sql.raw('"a"."id"')`);
    expect(source).toContain(".mapWith(generalActions.dueAt)");
    expect(source).toContain("input.offset");
    expect(source).toContain("input.limit");
  });
});
