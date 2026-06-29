import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 2C Calendar boundary regression (PRD #105, ADR-0071). Phase 2C wires the
 * real Google Calendar connect path, so it deliberately crosses the Phase 2B
 * "inert, no Google provider" boundary (PRD #98). These assertions pin the
 * boundaries that REMAIN true in 2C: Calendar uses Better Auth's Google provider
 * (no parallel OAuth subsystem), the only requested scope is Calendar event-read
 * (no Gmail/Contacts), OAuth token custody stays in Better Auth (provider_connections
 * stores no tokens, and OAuth tokens are encrypted at rest), and integrations still
 * live on the account page with no separate route. A future slice that crosses one
 * of these must do so deliberately and update this file.
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

describe("Phase 2C Calendar integration boundaries", () => {
  it("adds no separate settings/integrations route — integrations stay on the account page", () => {
    for (const route of ["settings", "integrations"]) {
      expect(existsSync(join(webApp, route))).toBe(false);
    }
  });

  it("adds no workspace/product-context route abstraction", () => {
    // ADR-0069: no generic product-context/workspace/multi-memory-scope abstraction.
    for (const route of ["workspace", "workspaces", "tenant", "tenants"]) {
      expect(existsSync(join(webApp, route))).toBe(false);
    }
  });

  it("stores no token, cursor, or provider-watermark columns in provider_connections", () => {
    // ADR-0071: token custody stays in Better Auth `account` records, never mirrored
    // into the product Provider Connection read model.
    const migration = readFileSync(
      join(repoRoot, "packages/db/migrations/0013_provider_connections.sql"),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "provider_connections"');
    for (const forbidden of ["token", "encrypted", "cursor", "watermark", "payload"]) {
      expect(migration.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("authorizes Calendar through Better Auth's Google provider, not a parallel OAuth subsystem", () => {
    const social = readFileSync(join(webSrc, "lib/auth/social.ts"), "utf8");
    const server = readFileSync(join(webSrc, "lib/auth/server.ts"), "utf8");
    // The Google provider is wired the same way as GitHub (a Better Auth social provider).
    expect(social).toContain("googleSocialProvider");
    expect(server).toContain("socialProviders");
    // OAuth tokens are encrypted at rest; Tendnote owns no provider-token table.
    expect(server).toContain("encryptOAuthTokens");
  });

  it("requests only the Calendar event-read scope — never Gmail or Contacts", () => {
    const social = readFileSync(join(webSrc, "lib/auth/social.ts"), "utf8");
    // The Google provider requests exactly one scope: the domain event-read constant.
    expect(social).toMatch(/scope:\s*\[GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE\]/);

    // That constant resolves to the narrow event-read scope, and the catalog that
    // defines it declares no Gmail/Contacts/broad-Calendar scope URLs.
    const catalog = readFileSync(
      join(repoRoot, "packages/domain/src/provider-connection-catalog.ts"),
      "utf8",
    ).toLowerCase();
    expect(catalog).toContain("auth/calendar.events.readonly");
    for (const forbidden of [
      "auth/gmail",
      "auth/contacts",
      "auth/calendar.readonly",
      "auth/calendar ",
    ]) {
      expect(catalog).not.toContain(forbidden);
    }
  });

  it("starts the connect flow through linkSocial, never a raw provider URL or token", () => {
    const connectButton = readFileSync(
      join(webSrc, "components/account/calendar-connect-button.tsx"),
      "utf8",
    );
    expect(connectButton).toContain("linkSocial");
    for (const forbidden of ["accounts.google.com", "access_token", "refresh_token"]) {
      expect(connectButton.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("makes no direct Calendar REST data reads from web sources yet (reads land in a later slice)", () => {
    // The OAuth scope URL is fine; a live Calendar v3 data fetch is not part of this slice.
    const sources = readSources(webSrc);
    for (const forbidden of ["googleapis.com/calendar/v3", "www.googleapis.com/calendar"]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("keeps the governing ADRs present", () => {
    for (const adr of [
      "0069-provider-connections-before-google-oauth.md",
      "0070-product-rate-limits-are-separate-from-auth-limits.md",
      "0071-google-calendar-oauth-uses-better-auth.md",
    ]) {
      expect(existsSync(join(repoRoot, "docs", "adr", adr))).toBe(true);
    }
  });
});
