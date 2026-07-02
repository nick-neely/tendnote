import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../../..");

/**
 * Calendar → Gmail handoff boundary (Phase 2D, ADR-0093). Calendar-derived
 * follow-ups may reach Gmail ONLY through the normal Tendnote lifecycle: a reviewed
 * (accepted) suggestion becomes a follow-up, the follow-up grounds a Tendnote draft,
 * the user approves it, and only then can it be externalized to Gmail through the
 * shared gate. These source-level guards pin that there is NO direct
 * Calendar-suggestion or event entry point into a Gmail write; the enforcement
 * itself is exercised in the db integration test
 * `gmail-drafts/calendar-handoff.test.ts`.
 *
 * Scope note: in Phase 2D the Calendar-suggestion REVIEW (accept) is a web surface
 * (`acceptCalendarSuggestedFollowupAction`); Eve joins the shared handoff at the
 * drafting step and onward (it drafts from a follow-up and saves to Gmail through the
 * same service + gate as the web UI).
 */

/** Lowercased source, so case can't create blind spots (mirrors phase-2c scans). */
function readLower(relativePath: string): string {
  const full = join(repoRoot, relativePath);
  expect(existsSync(full), `${relativePath} should exist`).toBe(true);
  return readFileSync(full, "utf8").toLowerCase();
}

const GMAIL_WRITE_SURFACES = [
  "apps/agent/agent/tools/save_draft_to_gmail.ts",
  "apps/web/src/lib/integrations/gmail-drafts.ts",
];

describe("Calendar → Gmail handoff stays behind reviewed follow-ups and drafts", () => {
  it("no Gmail write surface takes a Calendar suggestion or event id — only a Tendnote draft", () => {
    for (const relativePath of GMAIL_WRITE_SURFACES) {
      const source = readLower(relativePath);
      // The Gmail write is keyed on a Tendnote draft.
      expect(source).toMatch(/draftid|messagedraftid/);
      // It never reads Calendar, accepts a suggestion, or takes a raw event id — so a
      // reviewed follow-up cannot be skipped on the way to Gmail (ADR-0093). Tokens are
      // lowercased substrings of the real identifiers (e.g. CalendarSuggestedFollowup,
      // providerEventId, @tendnote/db/queries/calendar-followups).
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

  it("keeps the review→follow-up→draft→Gmail path intact and shared by web and Eve", () => {
    // The CALENDAR suggestion is reviewed into a follow-up through the web accept
    // action (Eve has no calendar-suggestion accept tool in this phase).
    expect(readLower("apps/web/src/app/actions/suggested-followups.ts")).toContain(
      "acceptcalendarsuggestedfollowup",
    );
    // A reviewed follow-up grounds a Tendnote draft (followupContext), never Gmail.
    expect(readLower("apps/agent/agent/tools/create_message_draft.ts")).toContain(
      "followupcontext",
    );
    // The Gmail step takes only the approved Tendnote draft and the shared service +
    // gate, so chat and web share one handoff policy from the draft onward
    // (ADR-0092/0093).
    for (const relativePath of GMAIL_WRITE_SURFACES) {
      const source = readLower(relativePath);
      expect(source).toContain("createdefaultgooglegmaildraftservice");
      expect(source).toContain("createdefaultgmailapprovalgate");
    }
  });

  it("keeps the governing ADR present", () => {
    expect(
      existsSync(
        join(repoRoot, "docs/adr/0093-calendar-followups-enter-gmail-through-tendnote-drafts.md"),
      ),
    ).toBe(true);
  });
});
