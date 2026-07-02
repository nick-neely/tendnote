import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../../..");

/**
 * Consolidated Phase 2D Gmail draft boundary (PRD #119, ADRs 0083-0097). Phase 2D
 * creates and updates Gmail DRAFTS behind explicit approval - and nothing else.
 * These policy-first scans pin the cross-cutting invariants the per-slice tests each
 * touch, so a regression anywhere in the Gmail path (db service/adapter, web surface,
 * or Eve tool) is mechanically hard to introduce:
 *
 * - never sends email; never reads Gmail history/mailbox/threads/labels; never
 *   reconciles sent/deleted/edited draft state;
 * - persists only minimized non-secret provider state (no raw payloads);
 * - requires a connected `google/gmail` capability + an approved Tendnote draft
 *   through ONE shared gate on both web and Eve;
 * - fails visibly with explicit retry (no background retry);
 * - never silently saves a manually entered recipient as a contact method;
 * - requests only the narrow `gmail.compose` scope; and Calendar-derived context
 *   cannot skip the reviewed-follow-up/Tendnote-draft path into Gmail.
 *
 * These read source/migrations only and never touch Google or the network. Runtime
 * shape invariants (adapter surface, recipient shape, current-intent updates, visible
 * retry) are exercised in `packages/db/src/queries/gmail-drafts/policy.test.ts`.
 */

const gmailDir = join(repoRoot, "packages/db/src/queries/gmail-drafts");
const gmailDbSources = readdirSync(gmailDir)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) => `packages/db/src/queries/gmail-drafts/${file}`);

const WEB_GMAIL_SOURCES = [
  "apps/web/src/lib/integrations/gmail-drafts.ts",
  "apps/web/src/app/actions/gmail-drafts.ts",
  "apps/web/src/lib/gmail-draft-view.ts",
  "apps/web/src/components/gmail-draft-panel.tsx",
];
const EVE_GMAIL_SOURCES = ["apps/agent/agent/tools/save_draft_to_gmail.ts"];

// Every non-test surface that can touch the Gmail draft write, across db, web, Eve.
const GMAIL_SOURCE_FILES = [
  "packages/db/src/queries/gmail-drafts.ts",
  ...gmailDbSources,
  ...WEB_GMAIL_SOURCES,
  ...EVE_GMAIL_SOURCES,
];

// The two owner-scoped entry points that actually write to Gmail (web + Eve).
const GMAIL_WRITE_SURFACES = [
  "apps/web/src/lib/integrations/gmail-drafts.ts",
  ...EVE_GMAIL_SOURCES,
];

// Broader-than-drafts Gmail scopes/paths Phase 2D must never request (read + send).
const BROAD_GMAIL_SCOPES = ["gmail.readonly", "gmail.modify", "gmail.send", "gmail.metadata"];

function read(relativePath: string): string {
  const full = join(repoRoot, relativePath);
  expect(existsSync(full), `${relativePath} should exist`).toBe(true);
  return readFileSync(full, "utf8");
}

/** All Gmail-path sources concatenated and lowercased, so casing can't hide a hit. */
const gmailSources = GMAIL_SOURCE_FILES.map(read).join("\n").toLowerCase();

describe("Phase 2D Gmail boundary - no send, no read, no reconcile", () => {
  it("never sends email - no send endpoint or send scope anywhere in the Gmail path", () => {
    for (const forbidden of [
      "messages/send",
      "drafts/send",
      "users/me/drafts/send",
      "gmail.send",
      "auth/gmail.send",
    ]) {
      expect(gmailSources).not.toContain(forbidden);
    }
  });

  it("never reads Gmail history/mailbox/threads/labels or requests a broader scope", () => {
    for (const forbidden of [
      "users/me/messages",
      "users/me/threads",
      "users/me/labels",
      "users/me/history",
      "mail.google.com",
      ...BROAD_GMAIL_SCOPES,
    ]) {
      expect(gmailSources).not.toContain(forbidden);
    }
  });

  it("requests only the narrow gmail.compose draft-write scope", () => {
    // The one scope Phase 2D requests, defined once in the domain (the broader-scope
    // absence is asserted in the no-read guard above).
    expect(read("packages/domain/src/gmail-drafts.ts")).toContain(
      "https://www.googleapis.com/auth/gmail.compose",
    );
  });
});

describe("Phase 2D Gmail boundary - minimized state, no raw payloads", () => {
  it("stores exactly the minimized non-secret columns - no raw payload/label/thread", () => {
    // Allowlist (not a blocklist): the gmail_draft_actions table must carry ONLY these
    // minimized columns, so ANY new column (a raw payload, thread, label, history,
    // mailbox blob, or even a body) fails this test until it is justified (ADR-0094).
    const migration = read("packages/db/migrations/0017_gmail_draft_actions.sql");
    const start = migration.indexOf('CREATE TABLE "gmail_draft_actions"');
    const block = migration.slice(start, migration.indexOf(");", start));
    // The column name is the first quoted token on each indented column line; the
    // enum type is a later token, so anchoring to line-start ignores it.
    const columns = [...block.matchAll(/^\s+"([a-z_]+)"/gm)].map((match) => match[1]);
    expect([...columns].sort()).toEqual(
      [
        "capability_key",
        "created_at",
        "gmail_draft_id",
        "id",
        "idempotency_key",
        "kind",
        "last_error_message",
        "message_draft_id",
        "owner_user_id",
        "provider_key",
        "recipient_contact_method_id",
        "recipient_email",
        "recipient_source",
        "status",
        "subject",
        "updated_at",
        "version",
      ].sort(),
    );
  });
});

describe("Phase 2D Gmail boundary - approval, no enrichment, no background retry", () => {
  it("routes both web and Eve through the ONE shared service + approval gate", () => {
    // Presence of the shared factories on BOTH surfaces (positive, fails loudly on a
    // rename) proves neither forks the approval/connection gate (ADR-0092). The gate's
    // enforcement itself is proven in gmail-drafts/gate.test.ts.
    for (const relativePath of GMAIL_WRITE_SURFACES) {
      const source = read(relativePath);
      expect(source).toContain("createDefaultGoogleGmailDraftService");
      expect(source).toContain("createDefaultGmailApprovalGate");
    }
  });

  it("never saves a manually entered recipient as a contact method (no enrichment)", () => {
    for (const forbidden of [
      "insert(contactmethods",
      "createcontactmethod",
      "update(contactmethods",
    ]) {
      expect(gmailSources).not.toContain(forbidden);
    }
  });

  it("fails visibly with explicit retry - no background timer schedules a Gmail write", () => {
    for (const forbidden of ["settimeout", "setinterval", "setimmediate"]) {
      expect(gmailSources).not.toContain(forbidden);
    }
  });
});

describe("Phase 2D Gmail boundary - Calendar context cannot skip the draft path", () => {
  it("no Gmail write surface takes a Calendar suggestion or event id - only a draft id", () => {
    for (const relativePath of GMAIL_WRITE_SURFACES) {
      const source = read(relativePath).toLowerCase();
      expect(source).toMatch(/draftid|messagedraftid/);
      // Lowercased substrings of the real identifiers (CalendarSuggestedFollowup,
      // providerEventId, @tendnote/db/queries/calendar-followups): a reviewed follow-up
      // and an approved Tendnote draft can never be skipped on the way to Gmail
      // (ADR-0093).
      for (const forbidden of [
        "queries/calendar",
        "calendarsuggest",
        "suggestedfollowup",
        "eventid",
        "calendarevent",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});

describe("Phase 2D Gmail boundary - coverage and docs", () => {
  it("covers every Gmail draft-write web/Eve surface (a new one must join the scan)", () => {
    // Guard against the hand-maintained list silently missing a future Gmail DRAFT
    // surface. Matches gmail-draft / draft-to-gmail file names (the write path), not
    // Gmail *connection* files (google-gmail-connection, gmail-connect-button), which
    // are connection surfaces covered by their own tests.
    const scanned = new Set(GMAIL_SOURCE_FILES);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(rel);
        } else if (
          /(gmail.*draft|draft.*gmail)/i.test(entry.name) &&
          /\.tsx?$/.test(entry.name) &&
          !/\.test\./.test(entry.name)
        ) {
          found.push(rel);
        }
      }
    };
    for (const root of ["apps/web/src", "apps/agent/agent"]) {
      walk(root);
    }
    for (const file of found) {
      expect(scanned.has(file), `${file} should be in GMAIL_SOURCE_FILES`).toBe(true);
    }
  });

  it("keeps subject suggestion deterministic (no model-backed generation, so no new eval)", () => {
    const domain = read("packages/domain/src/gmail-drafts.ts").toLowerCase();
    expect(domain).toContain("suggestgmailsubject");
    for (const forbidden of ['from "ai"', "generatetext", "gateway", "@ai-sdk"]) {
      expect(domain).not.toContain(forbidden);
    }
  });

  it("keeps the governing Phase 2D ADRs present", () => {
    const adrDir = join(repoRoot, "docs/adr");
    for (const adr of [
      "0083-gmail-drafts-externalize-approved-tendnote-drafts.md",
      "0089-gmail-draft-state-is-not-reconciled-in-phase-2d.md",
      "0092-eve-gmail-writes-use-shared-approval-gate.md",
      "0093-calendar-followups-enter-gmail-through-tendnote-drafts.md",
      "0094-gmail-draft-actions-store-minimized-provider-state.md",
      "0095-gmail-draft-first-slice-uses-to-subject-body.md",
      "0097-gmail-draft-verification-is-policy-first.md",
    ]) {
      expect(existsSync(join(adrDir, adr)), `${adr} present`).toBe(true);
    }
  });
});
