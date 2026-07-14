import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { briefItemKind } from "../schema/app/enums";
import { expectCalendarIsNotASemanticRecordKind } from "./calendar-boundary-fixtures";

/**
 * Consolidated Phase 2C Calendar boundary regression (PRD #105, ADR-0072/0075/
 * 0078/0079/0082). These pin the cross-cutting invariants the per-slice tests
 * each touch: no raw provider payload or token at rest, cached/derived Calendar
 * context stays out of retrieval, attendees never auto-create people, suggestions
 * stay reviewable (never active without acceptance), and Phase 2C does not expand
 * into Gmail/Contacts reads. Normal verification stays deterministic — these read
 * source/migrations only and never touch Google or the network.
 */

const dbRoot = join(import.meta.dirname, "../..");
const queriesDir = join(import.meta.dirname);
const migrationsDir = join(dbRoot, "migrations");

function readDirSources(dir: string): string {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
        out.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(dir);
  return out.join("\n");
}

// The Calendar query surface is the two capability directories PLUS their
// top-level seam files (`calendar.ts` exposes `readConnectedOwnerCalendar`;
// `calendar-followups.ts` is the suggestion acceptance path). The seam files are
// siblings of the directories, so they must be read explicitly or a boundary
// violation added there would escape these scans.
const calendarSources = [
  readDirSources(join(queriesDir, "calendar")),
  readDirSources(join(queriesDir, "calendar-followups")),
  readFileSync(join(queriesDir, "calendar.ts"), "utf8"),
  readFileSync(join(queriesDir, "calendar-followups.ts"), "utf8"),
].join("\n");

describe("Phase 2C Calendar boundaries (db)", () => {
  it("stores no raw provider payload, token, or cursor columns in any Calendar table", () => {
    // Pinned by name: 0014 is the calendar_event_cache table, 0016 is
    // calendar_suggested_followups. A future slice that adds a Calendar column
    // must add its migration here (or this guard silently stops covering it).
    for (const migration of ["0014_puzzling_maggott.sql", "0016_cuddly_stellaris.sql"]) {
      const sql = readFileSync(join(migrationsDir, migration), "utf8").toLowerCase();
      for (const forbidden of [
        '"raw_payload"',
        '"payload"',
        '"access_token"',
        '"refresh_token"',
        '"token"',
        '"sync_cursor"',
        '"cursor"',
        '"watermark"',
        '"embedding"',
        "vector(",
        "tsvector(",
      ]) {
        expect(sql).not.toContain(forbidden);
      }
    }
  });

  it("logs no Calendar token or raw provider payload — the modules emit no log sink at all", () => {
    // Token custody and raw payloads must never leak to logs (PRD #105, AC1).
    // The Calendar modules carry no logging sink today; pinning that absence keeps
    // a future log line from silently shipping a token or provider event. A slice
    // that genuinely needs Calendar logging must add a payload-safe sink and
    // update this guard deliberately.
    // `console.*` and `logger.*` are the only logging sinks this repo uses.
    for (const forbidden of ["console.", "logger."]) {
      expect(calendarSources).not.toContain(forbidden);
    }
  });

  it("keeps cached/derived Calendar context out of semantic retrieval", () => {
    // Durable memories, retained source records, and General Actions are semantically
    // embedded (ADR 0150); Calendar context enters retrieval only after explicit
    // promotion (ADR-0079), so it is never a semantic record kind.
    expectCalendarIsNotASemanticRecordKind();
    for (const forbidden of [
      "semantic-retrieval",
      "relationship-context-search",
      "enqueueSemanticEmbeddingJob",
      "embedding",
      "tsvector",
    ]) {
      expect(calendarSources).not.toContain(forbidden);
    }
  });

  it("never auto-creates people from Calendar attendees", () => {
    // Attendee matching reads people/contact methods; it must never create a person.
    for (const forbidden of ["createPerson", "insert(people)", "into people"]) {
      expect(calendarSources).not.toContain(forbidden);
    }
  });

  it("persists Calendar suggestions as suggested — never an active reminder by default", () => {
    const store = readFileSync(join(queriesDir, "calendar-followups/in-memory-store.ts"), "utf8");
    expect(store).toContain('status: "suggested"');
    // The calendar suggestion module never writes an active follow-up status itself;
    // acceptance promotes through the existing lifecycle (createFollowup) instead.
    for (const forbidden of ['status: "open"', 'status: "active"']) {
      expect(calendarSources).not.toContain(forbidden);
    }
  });

  it("adds the calendar_event brief kind but no Gmail/Contacts capability reads", () => {
    expect(briefItemKind.enumValues).toContain("calendar_event");
    // Phase 2D adds a write-only Gmail *draft* module (`gmail-drafts`), and Phase
    // 2E adds an explicit Contacts preview module. Neither belongs to Calendar
    // sources, and no Gmail mailbox/history read module may appear. The Gmail
    // no-read boundary itself is pinned in the Phase 2D policy tests (#126); here
    // we keep Phase 2C's Calendar sources clean of Gmail/Contacts provider reads.
    const queryEntries = readdirSync(queriesDir);
    const gmailContactsModules = queryEntries.filter((name) => /gmail|contacts/i.test(name)).sort();
    expect(gmailContactsModules).toEqual([
      "contacts-import-preview",
      "contacts-import-preview.ts",
      "gmail-drafts",
      "gmail-drafts.ts",
    ]);
    for (const forbidden of [
      "auth/gmail",
      "auth/contacts",
      "gmail.googleapis",
      "people.googleapis",
    ]) {
      expect(calendarSources.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps the governing ADRs present", () => {
    const adrDir = join(dbRoot, "../../docs/adr");
    for (const adr of [
      "0079-calendar-cache-is-not-retrieval-truth.md",
      "0078-calendar-attendees-match-existing-people.md",
      "0082-calendar-followup-classification-is-deterministic-first.md",
    ]) {
      expect(existsSync(join(adrDir, adr))).toBe(true);
    }
  });
});
