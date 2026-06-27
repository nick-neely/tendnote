import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";
import { AssistantToolResult } from "./assistant-tool-result";

function render(view: AssistantToolView): string {
  return renderToStaticMarkup(<AssistantToolResult view={view} />);
}

describe("AssistantToolResult (persisted Eve tool result rendering)", () => {
  it("renders a saved source record as logged context, not a confirmed fact", () => {
    const html = render({
      kind: "saved_source_record",
      sourceRecordId: "source-1",
      content: "Had lunch with Mark.",
      linkedPersonId: "person-1",
    });

    expect(html).toContain("Logged");
    expect(html).toContain("You noted");
    expect(html).toContain("Had lunch with Mark.");
    expect(html).toContain("not a confirmed fact");
    expect(html).toContain('data-tool-view="saved_source_record"');
  });

  it("renders a saved memory as a confirmed fact", () => {
    const html = render({
      kind: "saved_memory",
      memoryId: "memory-1",
      sourceRecordId: "source-1",
      personId: "person-1",
      personName: "Caleb",
      content: "Caleb is moving to Denver in August.",
    });

    expect(html).toContain("Saved to memory");
    expect(html).toContain("Confirmed fact");
    expect(html).toContain("grounded in a source record");
    expect(html).toContain("Caleb is moving to Denver in August.");
  });

  it("does not claim source-record provenance when the memory has none", () => {
    const html = render({
      kind: "saved_memory",
      memoryId: "memory-1",
      sourceRecordId: null,
      personId: null,
      personName: null,
      content: "A standalone fact.",
    });

    expect(html).toContain("Confirmed fact");
    expect(html).not.toContain("grounded in a source record");
  });

  it("does not render the suggested-memory review here — that is the interactive ChatReviewCard", () => {
    const html = render({
      kind: "suggested_memory_review",
      memoryId: "memory-2",
      content: "Maybe switching jobs.",
      sourceRecordId: "source-2",
      personId: "person-1",
      personName: "Mark",
    });

    // This presentational module stays free of the server actions the inline
    // approve/dismiss needs; the panel routes this kind to ChatReviewCard.
    expect(html).toBe("");
  });

  it("renders person context with per-tier counts and snapshot status", () => {
    const html = render({
      kind: "person_context",
      personId: "person-1",
      personName: "Mark",
      snapshotStatus: "fresh",
      approvedCount: 1,
      loggedCount: 2,
      suggestedCount: 1,
    });

    expect(html).toContain("Mark");
    expect(html).toContain("1 confirmed");
    expect(html).toContain("2 logged");
    expect(html).toContain("1 to review");
    expect(html).toContain("snapshot fresh");
  });

  it("renders exact recall person results as grounded links", () => {
    const html = render({
      kind: "relationship_context_search",
      results: [
        {
          recordKind: "person",
          recordId: "person-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Talked about backend architecture.",
          matchedFields: ["profileBlurb"],
          trustLevel: "identity_reference",
          sensitivity: "normal",
        },
      ],
    });

    expect(html).toContain("Found 1 exact match");
    expect(html).toContain("Mara Lin");
    expect(html).toContain("Talked about backend architecture.");
    expect(html).toContain("Identity reference");
    expect(html).toContain('href="/people/person-1"');
    expect(html).toContain('data-tool-view="relationship_context_search"');
  });

  it("renders empty exact recall results as a quiet line, not an expandable card", () => {
    const html = render({ kind: "relationship_context_search", results: [] });

    expect(html).toContain("No matching relationship context found");
    // An empty result set recedes to a line; no disclosure summary or card chrome.
    expect(html).not.toContain("Found 0 exact matches");
    expect(html).not.toContain('data-tool-view="relationship_context_search"');
  });

  it("renders exact recall source-record results as logged context, not confirmed fact", () => {
    const html = render({
      kind: "relationship_context_search",
      results: [
        {
          recordKind: "source_record",
          recordId: "source-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Logged lunch about backend architecture.",
          matchedFields: ["content"],
          trustLevel: "logged_context",
          sensitivity: "normal",
        },
      ],
    });

    expect(html).toContain("Source record");
    expect(html).toContain("You noted");
    expect(html).toContain("Logged context");
    expect(html).not.toContain("Confirmed fact");
    expect(html).toContain('href="/people/person-1"');
  });

  it("renders mixed exact recall results with separate trust language per record", () => {
    const html = render({
      kind: "relationship_context_search",
      results: [
        {
          recordKind: "person",
          recordId: "person-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Talked about backend architecture.",
          matchedFields: ["profileBlurb"],
          trustLevel: "identity_reference",
          sensitivity: "normal",
        },
        {
          recordKind: "memory",
          recordId: "memory-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Mara prefers backend architecture conversations.",
          matchedFields: ["content"],
          trustLevel: "confirmed_fact",
          sensitivity: "normal",
        },
        {
          recordKind: "source_record",
          recordId: "source-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Logged lunch about backend architecture.",
          matchedFields: ["content"],
          trustLevel: "logged_context",
          sensitivity: "normal",
        },
      ],
    });

    expect(html).toContain("Found 3 exact matches");
    expect(html).toContain("Person");
    expect(html).toContain("Memory");
    expect(html).toContain("Source record");
    expect(html).toContain("Identity reference");
    expect(html).toContain("Confirmed fact");
    expect(html).toContain("Logged context");
    expect(html).toContain("You noted");
    expect(html).toContain('href="/people/person-1"');
  });

  it("renders semantic recall results as grounded records without visible record ids", () => {
    const html = render({
      kind: "semantic_context_search",
      results: [
        {
          recordKind: "memory",
          recordId: "memory-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          snippet: "Mara loves handmade kitchen gifts.",
          similarity: 0.94,
          trustLevel: "confirmed_fact",
          sensitivity: "normal",
        },
        {
          recordKind: "source_record",
          recordId: "source-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          snippet: "Mara mentioned a possible career change.",
          similarity: 0.88,
          trustLevel: "logged_context",
          sensitivity: "sensitive",
        },
      ],
    });

    expect(html).toContain("Found 2 semantic matches");
    expect(html).toContain("Memory");
    expect(html).toContain("Source record");
    expect(html).toContain("Confirmed fact");
    expect(html).toContain("Logged context");
    expect(html).toContain("Sensitive");
    expect(html).toContain("You noted");
    expect(html).toContain("Mara loves handmade kitchen gifts.");
    expect(html).toContain("Mara mentioned a possible career change.");
    expect(html).not.toContain("memory-1");
    expect(html).not.toContain("source-1");
    expect(html).toContain('data-tool-view="semantic_context_search"');
  });

  it("renders empty semantic recall results as a quiet line", () => {
    const html = render({ kind: "semantic_context_search", results: [] });

    expect(html).toContain("No semantic matches found");
    expect(html).not.toContain("Found 0 semantic matches");
    expect(html).not.toContain('data-tool-view="semantic_context_search"');
  });

  it("renders agenda results as compact grounded rows without visible raw ids", () => {
    const html = render({
      kind: "relationship_agenda",
      candidates: [
        {
          kind: "due_followup",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Follow up with Mara Lin",
          reason: "Ask about the move.",
          dueLabel: "Jul 2, 2026",
          sourceRefs: [{ kind: "followup", id: "followup-1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          rank: 1,
        },
        {
          kind: "birthday",
          personId: "person-2",
          personDisplayName: "Sam Rivera",
          title: "Sam Rivera's birthday",
          reason: "Birthday falls inside the requested window.",
          dueLabel: "Jul 5, 2026",
          sourceRefs: [{ kind: "person", id: "person-2" }],
          trustLevel: "stored_profile_data",
          sensitivity: "normal",
          rank: 2,
        },
      ],
    });

    expect(html).toContain("Found 2 agenda items");
    expect(html).toContain("Follow-up");
    expect(html).toContain("Birthday");
    expect(html).toContain("Mara Lin");
    expect(html).toContain("Sam Rivera");
    expect(html).toContain("Ask about the move.");
    expect(html).toContain("Active reminder");
    expect(html).toContain("Stored profile data");
    expect(html).toContain("Due Jul 2, 2026");
    expect(html).toContain("Upcoming Jul 5, 2026");
    expect(html).toContain("Grounded in follow-up");
    expect(html).toContain("Grounded in person");
    expect(html).toContain('href="/people/person-1"');
    expect(html).toContain('data-tool-view="relationship_agenda"');
    expect(html).not.toContain("followup-1");
  });

  it("renders tentative and restricted agenda candidates with explicit labels", () => {
    const html = render({
      kind: "relationship_agenda",
      candidates: [
        {
          kind: "suggested_followup",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Review suggested follow-up for Mara Lin",
          reason: "Ask whether the move happened.",
          dueLabel: "Jul 4, 2026",
          sourceRefs: [
            { kind: "followup", id: "followup-2" },
            { kind: "source_record", id: "source-1" },
          ],
          trustLevel: "tentative",
          sensitivity: "sensitive",
          rank: 1,
        },
        {
          kind: "semantic_context",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Restricted related context for Mara Lin",
          reason: "Restricted context.",
          dueLabel: null,
          sourceRefs: [{ kind: "source_record", id: "source-restricted" }],
          trustLevel: "logged_context",
          sensitivity: "restricted",
          rank: 2,
        },
      ],
    });

    expect(html).toContain("Suggested follow-up");
    expect(html).toContain("Tentative");
    expect(html).toContain("Sensitive");
    expect(html).toContain("Suggested for Jul 4, 2026");
    expect(html).toContain("Restricted");
    expect(html).toContain("Restricted related context for Mara Lin");
    expect(html).toContain("Grounded in follow-up + source record");
    expect(html).not.toContain("source-restricted");
  });

  it("renders empty agenda results as a quiet line", () => {
    const html = render({ kind: "relationship_agenda", candidates: [] });

    expect(html).toContain("Nothing on the relationship agenda for that window");
    expect(html).not.toContain("Found 0 agenda items");
    expect(html).not.toContain('data-tool-view="relationship_agenda"');
  });

  it("renders an unknown tool result as a quiet ambient line", () => {
    const html = render({ kind: "generic", toolName: "some_future_tool" });

    // The humanized name carries it; no card chrome and no redundant "Done".
    expect(html).toContain("some future tool");
    expect(html).not.toContain('data-tool-view="generic"');
  });
});
