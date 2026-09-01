import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "better-auth-accounts.ts"), "utf8");

describe("Better Auth account id resolver contract", () => {
  it("owner-scopes the lookup and reads no token column", () => {
    expect(source).toContain("eq(account.userId, ownerUserId)");
    expect(source).toContain("eq(account.providerId, providerId)");
    // Token custody stays inside Better Auth (ADR-0071): only the row's identity
    // is selected here, so a widened select is a boundary change, not a tweak.
    expect(source).toContain("select({ id: account.id })");
    expect(source).not.toMatch(/account\.(accessToken|refreshToken|idToken|password)/);
  });

  /**
   * An owner can hold more than one account row per provider, so `limit(1)` has
   * to be ordered. Without it Postgres may return either row, and Better Auth
   * rewrites the row on every token refresh — so the answer could move between
   * two reads for the same owner.
   */
  it("breaks a multi-account tie deterministically instead of taking any row", () => {
    expect(source).toContain("orderBy(asc(account.createdAt), asc(account.id))");
    expect(source.indexOf("orderBy(")).toBeLessThan(source.indexOf(".limit(1)"));
  });
});
