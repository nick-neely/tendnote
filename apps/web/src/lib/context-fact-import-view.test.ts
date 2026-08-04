import type { ContextFactImportSummary } from "@tendnote/db/queries/context-fact-imports";
import { describe, expect, it } from "vitest";
import {
  contextFactImportEmptyHint,
  contextFactImportHeadline,
  contextFactImportNotes,
  contextFactImportSourceNote,
} from "./context-fact-import-view";

function summary(overrides: Partial<ContextFactImportSummary> = {}): ContextFactImportSummary {
  return {
    importId: "import-1",
    provider: "chatgpt",
    source: "block",
    suggestedCount: 0,
    alreadyPendingCount: 0,
    skippedCount: 0,
    unreadableCount: 0,
    readByModel: false,
    ...overrides,
  };
}

describe("contextFactImportHeadline", () => {
  it("leads with what is waiting, named for the assistant it came from", () => {
    expect(contextFactImportHeadline(summary({ suggestedCount: 4, provider: "gemini" }))).toBe(
      "4 facts from Gemini to review.",
    );
  });

  it("stays singular for one fact", () => {
    expect(contextFactImportHeadline(summary({ suggestedCount: 1 }))).toBe(
      "1 fact from ChatGPT to review.",
    );
  });

  it("says a repeat import found what was already waiting", () => {
    expect(contextFactImportHeadline(summary({ alreadyPendingCount: 3 }))).toBe(
      "3 facts from ChatGPT were already waiting for you.",
    );
  });

  it("names an empty import plainly, without blaming the owner", () => {
    const headline = contextFactImportHeadline(summary({ provider: "claude" }));

    expect(headline).toBe("Nothing new from Claude this time.");
    expect(headline).not.toMatch(/fail|error|sorry|couldn't/i);
  });
});

describe("contextFactImportNotes", () => {
  it("says nothing when there is nothing to explain", () => {
    expect(contextFactImportNotes(summary({ suggestedCount: 2 }))).toEqual([]);
  });

  it("accounts for everything the import did not offer", () => {
    expect(
      contextFactImportNotes(
        summary({
          suggestedCount: 2,
          alreadyPendingCount: 1,
          skippedCount: 2,
          unreadableCount: 3,
        }),
      ),
    ).toEqual([
      "1 other fact was already waiting for you.",
      "2 facts you dismissed before stayed dismissed.",
      "3 lines could not be read as a fact and were left out.",
    ]);
  });

  it("does not repeat the headline's own count", () => {
    expect(contextFactImportNotes(summary({ alreadyPendingCount: 3 }))).toEqual([]);
  });
});

describe("contextFactImportSourceNote", () => {
  it("tells the owner when a paste never left the app", () => {
    expect(contextFactImportSourceNote(summary({ source: "block" }))).toContain(
      "never left your notebook",
    );
  });

  it("tells the owner when a paste reached the extraction model", () => {
    expect(
      contextFactImportSourceNote(summary({ source: "extraction", readByModel: true })),
    ).toContain("extraction model");
  });

  it("never claims a model read a paste when none ran", () => {
    const note = contextFactImportSourceNote(summary({ source: "extraction" }));

    expect(note).toContain("unavailable here");
    expect(note).not.toContain("extraction model");
  });
});

describe("contextFactImportEmptyHint", () => {
  it("points a blocked paste back at the code block", () => {
    expect(contextFactImportEmptyHint(summary({ source: "extraction" }))).toContain("code block");
  });

  it("offers the manual path when the block itself held nothing durable", () => {
    expect(contextFactImportEmptyHint(summary({ source: "block" }))).toContain("add one yourself");
  });
});
