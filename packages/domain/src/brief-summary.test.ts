import { describe, expect, it } from "vitest";
import {
  type BriefSummaryItem,
  buildBriefSummaryPrompt,
  DETERMINISTIC_BRIEF_SUMMARY_VERSION,
  generateDeterministicBriefSummary,
} from "./brief-summary";

const items: BriefSummaryItem[] = [
  {
    kind: "due_followup",
    personDisplayName: "Mark",
    title: "Follow up with Mark",
    reason: "Reconnect about the move.",
  },
  {
    kind: "birthday",
    personDisplayName: "Nadia",
    title: "Nadia's birthday",
    reason: "Birthday falls inside the window.",
  },
];

describe("generateDeterministicBriefSummary", () => {
  it("builds a friendly line naming the people, with deterministic provenance", () => {
    const result = generateDeterministicBriefSummary({ cadence: "daily", items });

    expect(result.summary).toContain("Mark");
    expect(result.summary).toContain("Nadia");
    expect(result.summary).toContain("today");
    expect(result.provenance).toEqual({
      generator: "deterministic",
      version: DETERMINISTIC_BRIEF_SUMMARY_VERSION,
    });
  });

  it("uses the weekly label and pluralizes for the weekly review", () => {
    const result = generateDeterministicBriefSummary({ cadence: "weekly", items });
    expect(result.summary).toContain("this week");
    expect(result.summary).toMatch(/people/);
  });

  it("does not break when items have no person", () => {
    const result = generateDeterministicBriefSummary({
      cadence: "daily",
      items: [
        { kind: "review_item", personDisplayName: null, title: "Resolve", reason: "Context." },
      ],
    });
    expect(result.summary).toContain("today");
  });
});

describe("buildBriefSummaryPrompt", () => {
  it("includes each item and forbids inventing content", () => {
    const prompt = buildBriefSummaryPrompt({ cadence: "daily", items });
    expect(prompt).toContain("Follow up with Mark");
    expect(prompt).toContain("Nadia's birthday");
    expect(prompt).toMatch(/Do not invent/i);
  });
});
