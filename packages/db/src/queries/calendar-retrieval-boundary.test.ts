import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { semanticRecordKind } from "../schema/app/enums";

/**
 * Phase 2C retrieval boundary (ADR-0079): cached Calendar events are not approved
 * memory or retained source records and must NOT enter exact (full-text) or
 * semantic retrieval by default. Calendar context enters normal retrieval only
 * after an explicit product workflow promotes it into durable Tendnote state.
 */

const calendarDir = join(import.meta.dirname, "calendar");

function readCalendarSources(): string {
  return readdirSync(calendarDir)
    .filter((entry) => /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry))
    .map((entry) => readFileSync(join(calendarDir, entry), "utf8"))
    .join("\n");
}

describe("Calendar cache stays out of retrieval", () => {
  it("does not add Calendar to the semantic record kinds", () => {
    // Durable memories, retained source records, and General Actions are semantically
    // embedded (ADR 0150); Calendar cache is never a semantic record kind.
    expect(semanticRecordKind.enumValues).toEqual(["memory", "source_record", "general_action"]);
  });

  it("the Calendar read/cache seam imports no retrieval or embedding machinery", () => {
    const sources = readCalendarSources();
    for (const forbidden of [
      "semantic-retrieval",
      "relationship-context-search",
      "embedding",
      "tsvector",
      "enqueueSemanticEmbeddingJob",
    ]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("the Calendar cache table stores no embedding/tsvector/raw-payload columns", () => {
    const schema = readFileSync(
      join(import.meta.dirname, "../schema/app/calendar-event-cache.ts"),
      "utf8",
    ).toLowerCase();
    expect(schema).toContain('"calendar_event_cache"');
    // Match column-definition forms, not the prose comment that explains the absence.
    for (const forbidden of [
      '"embedding"',
      "tsvector(",
      "vector(",
      '"raw_payload"',
      '"sync_cursor"',
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });
});
