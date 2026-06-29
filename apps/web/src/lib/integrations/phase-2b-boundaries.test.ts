import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 2B boundary regression (PRD #98, ADR-0069, ADR-0070). These assert the
 * integration-settings + rate-limit foundation stays INERT: no live OAuth, no
 * token/cursor storage, no separate settings/integrations route, and no premature
 * workspace/product-context abstraction. They are intentionally "absence" tests —
 * a future slice that crosses a boundary must do so deliberately and update these.
 */

const dirname = import.meta.dirname;
const repoRoot = join(dirname, "../../../../..");
const webSrc = join(dirname, "../..");
const webApp = join(webSrc, "app");

/** All non-test TypeScript sources under `root`, lowercased and concatenated. */
function readSources(root: string): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(root);
  return out.join("\n").toLowerCase();
}

describe("Phase 2B integration + rate-limit boundaries", () => {
  it("adds no separate settings/integrations route — integrations stay on the account page", () => {
    // PRD #98 Implementation Decisions: "A separate settings or integrations route
    // is deferred until live integrations ... justify it."
    for (const route of ["settings", "integrations"]) {
      expect(existsSync(join(webApp, route))).toBe(false);
    }
  });

  it("adds no workspace/product-context route abstraction", () => {
    // ADR-0069: "should also not add a generic product-context, workspace, or
    // multi-memory-scope abstraction."
    for (const route of ["workspace", "workspaces", "tenant", "tenants"]) {
      expect(existsSync(join(webApp, route))).toBe(false);
    }
  });

  it("stores no token, cursor, or provider-watermark columns in the provider_connections migration", () => {
    const migration = readFileSync(
      join(repoRoot, "packages/db/migrations/0013_provider_connections.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "provider_connections"');
    // `authorized_scopes` (non-secret) is permitted; tokens/cursors/watermarks are not.
    for (const forbidden of ["token", "encrypted", "cursor", "watermark", "payload"]) {
      expect(migration.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps the account connect affordance inert — no link, no live OAuth, no token handling", () => {
    const section = readFileSync(
      join(webSrc, "components/account/provider-connections-section.tsx"),
      "utf8",
    );
    // The affordance is a disabled control, never a link to a live authorization flow.
    expect(section).toContain("disabled");
    expect(section).not.toContain("href");
    for (const forbidden of [
      "accounts.google.com",
      "googleapis.com",
      "access_token",
      "refresh_token",
    ]) {
      expect(section.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("adds no Google sign-in/account-linking and requests no Google provider scopes", () => {
    // ADR-0067/0069: Phase 2B requests no external scopes and does not make Google
    // sign-in/linking the default; Google is deliberately omitted from socialProviders.
    const authSources = ["server.ts", "social.ts"]
      .map((file) => join(webSrc, "lib/auth", file))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8").toLowerCase())
      .join("\n");

    // Non-vacuous: fail loudly if the auth files move rather than passing silently.
    expect(authSources.length).toBeGreaterThan(0);
    // No Google social/linking provider wired (matches the githubSocialProvider idiom).
    expect(authSources).not.toContain("googlesocialprovider");
    expect(authSources).not.toMatch(/socialproviders\s*:\s*\{[^}]*google/);
    // No provider OAuth scope requests.
    for (const forbidden of [
      "googleapis.com/auth",
      "auth/calendar",
      "auth/gmail",
      "auth/contacts",
    ]) {
      expect(authSources).not.toContain(forbidden);
    }
  });

  it("makes no live provider API calls from web sources (no Calendar/Gmail/Contacts reads)", () => {
    const sources = readSources(webSrc);
    for (const forbidden of ["googleapis.com", "accounts.google.com"]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("keeps the governing ADRs present", () => {
    for (const adr of [
      "0069-provider-connections-before-google-oauth.md",
      "0070-product-rate-limits-are-separate-from-auth-limits.md",
    ]) {
      expect(existsSync(join(repoRoot, "docs", "adr", adr))).toBe(true);
    }
  });
});
