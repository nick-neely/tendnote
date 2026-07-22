import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("Today feedback Drizzle store contract", () => {
  it("owner-scopes feedback reads and transactionally audits inserts and updates", () => {
    expect(source).toContain("eq(todayFeedback.ownerUserId, input.ownerUserId)");
    expect(source).toContain("getDb().transaction");
    expect(source).toContain(".onConflictDoUpdate(");
    expect(source).toContain("tx.insert(auditLog)");
    expect(source).toContain('action: "today.feedback_saved"');
  });
});
