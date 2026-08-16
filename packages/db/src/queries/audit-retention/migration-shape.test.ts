import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0073_audit_log_retention.sql"),
  "utf8",
);
const journal = readFileSync(
  join(import.meta.dirname, "../../../migrations/meta/_journal.json"),
  "utf8",
);
const schema = readFileSync(join(import.meta.dirname, "../../schema/app/audit-log.ts"), "utf8");

describe("audit log retention persistence contract", () => {
  it("keeps the bounded sweep on a created-at index with a descriptive migration", () => {
    expect(journal).toContain('"tag": "0073_audit_log_retention"');
    expect(migration).toContain(
      'CREATE INDEX "audit_log_created_at_id_idx" ON "audit_log" USING btree ("created_at","id")',
    );
    expect(schema).toContain('index("audit_log_created_at_id_idx").on(table.createdAt, table.id)');
  });
});
