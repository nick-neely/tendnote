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

  it("renders an updated person as a confirmed card naming the changed fields", () => {
    const html = render({
      kind: "updated_person",
      personId: "person-1",
      displayName: "Mara Lin",
      relationshipType: "colleague",
      updatedFields: ["displayName", "birthday"],
    });

    expect(html).toContain("Updated in your notebook");
    expect(html).toContain("Mara Lin");
    // Raw field keys are humanized and joined for the user.
    expect(html).toContain("Updated name and birthday");
    expect(html).toContain('data-tool-view="updated_person"');
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
          visibilityChoice: null,
          visibilityLabel: null,
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
          visibilityChoice: "only_me",
          visibilityLabel: "Only me",
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
          visibilityChoice: null,
          visibilityLabel: null,
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
          visibilityChoice: "only_me",
          visibilityLabel: "Only me",
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
          visibilityChoice: "only_me",
          visibilityLabel: "Only me",
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
          visibilityChoice: "only_me",
          visibilityLabel: "Only me",
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
          visibilityChoice: "only_me",
          visibilityLabel: "Only me",
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

  it("places dated agenda candidates on the calendar with accessible day labels", () => {
    const html = render({
      kind: "relationship_agenda",
      candidates: [
        {
          kind: "due_followup",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Follow up with Mara Lin",
          reason: "Ask about the move.",
          dueAt: "2026-07-02T12:00:00.000Z",
          dueLabel: "Jul 2, 2026",
          sourceRefs: [{ kind: "followup", id: "followup-1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          visibilityChoice: "selected_members",
          visibilityLabel: "Specific people",
          rank: 1,
        },
        {
          kind: "birthday",
          personId: "person-2",
          personDisplayName: "Sam Rivera",
          title: "Sam Rivera's birthday",
          reason: "Birthday falls inside the requested window.",
          dueAt: "2026-07-05T00:00:00.000Z",
          dueLabel: "Jul 5, 2026",
          sourceRefs: [{ kind: "person", id: "person-2" }],
          trustLevel: "stored_profile_data",
          sensitivity: "normal",
          rank: 2,
        },
      ],
    });

    expect(html).toContain("Found 2 agenda items");
    // Dated items live on the grid; their person and title ride the day cell's
    // accessible label so screen readers and search hit them without a click.
    // (renderToStaticMarkup HTML-escapes the apostrophe inside aria-label, so we
    // assert on the unambiguous person/title fragments rather than the raw "'s".)
    expect(html).toContain("Follow up with Mara Lin");
    expect(html).toContain("Mara Lin");
    expect(html).toContain("Specific people");
    expect(html).toContain("Sam Rivera");
    expect(html).toContain("birthday");
    expect(html).toContain('data-tool-view="relationship_agenda"');
    expect(html).not.toContain("followup-1");
  });

  it("keeps undated review context in the rail while dated items ride the grid", () => {
    const html = render({
      kind: "relationship_agenda",
      candidates: [
        {
          kind: "suggested_followup",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Review suggested follow-up for Mara Lin",
          reason: "Ask whether the move happened.",
          dueAt: "2026-07-04T12:00:00.000Z",
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
          dueAt: null,
          dueLabel: null,
          sourceRefs: [{ kind: "source_record", id: "source-restricted" }],
          trustLevel: "logged_context",
          sensitivity: "restricted",
          rank: 2,
        },
      ],
    });

    // The legend names what each color means — never color alone.
    expect(html).toContain("To review");
    expect(html).toContain("Logged");
    // The dated suggestion rides the calendar (its title is on the day cell)…
    expect(html).toContain("Review suggested follow-up for Mara Lin");
    // …while the undated, restricted context stays fully spelled out in the rail.
    expect(html).toContain("Restricted related context for Mara Lin");
    expect(html).toContain("Restricted");
    expect(html).toContain("Logged context");
    expect(html).toContain("Grounded in source record");
    expect(html).toContain('href="/people/person-1"');
    expect(html).not.toContain("source-restricted");
    expect(html).not.toContain("followup-2");
  });

  it("falls back to a plain rail when no candidate carries a date", () => {
    const html = render({
      kind: "relationship_agenda",
      candidates: [
        {
          kind: "review_item",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Review suggested memory for Mara Lin",
          reason: "Maybe switching jobs.",
          dueAt: null,
          dueLabel: null,
          sourceRefs: [{ kind: "memory", id: "memory-9" }],
          trustLevel: "tentative",
          sensitivity: "normal",
          rank: 1,
        },
      ],
    });

    expect(html).toContain("Found 1 agenda item");
    expect(html).toContain("Relationship agenda");
    expect(html).toContain("Review suggested memory for Mara Lin");
    expect(html).toContain("Tentative");
    expect(html).toContain('data-tool-view="relationship_agenda"');
    expect(html).not.toContain("memory-9");
  });

  it("renders empty agenda results as a quiet line", () => {
    const html = render({ kind: "relationship_agenda", candidates: [] });

    expect(html).toContain("Nothing on the relationship agenda for that window");
    expect(html).not.toContain("Found 0 agenda items");
    expect(html).not.toContain('data-tool-view="relationship_agenda"');
  });

  it("renders Memory Curator proposals as grounded review-only cards", () => {
    const html = render({
      kind: "memory_curator_proposals",
      proposals: [
        {
          id: "duplicate_memory:memory-1:memory-2",
          proposalKind: "duplicate_memory",
          personId: "person-1",
          personDisplayName: "Maya",
          title: "Possible duplicate memory for Maya",
          reason: "Two approved memories have the same normalized content.",
          suggestedAction: "Review both memories before changing anything.",
          sourceRefs: [
            { kind: "memory", id: "memory-1", label: "Maya lives in Austin." },
            { kind: "memory", id: "memory-2", label: "Maya lives in Austin." },
          ],
          sensitivity: "normal",
          reviewOnly: true,
        },
      ],
    });

    expect(html).toContain("Memory cleanup proposal");
    expect(html).toContain("Review-only cleanup proposals");
    expect(html).toContain("no memories changed");
    expect(html).toContain("Possible duplicate memory for Maya");
    expect(html).toContain("Review both memories before changing anything.");
    expect(html).toContain("Memory: Maya lives in Austin.");
    expect(html).toContain('data-tool-view="memory_curator_proposals"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("form");
  });

  it("renders empty Memory Curator proposals as a quiet line", () => {
    const html = render({ kind: "memory_curator_proposals", proposals: [] });

    expect(html).toContain("No memory cleanup proposals found");
    expect(html).not.toContain('data-tool-view="memory_curator_proposals"');
  });

  it("renders Draft Proposals as grounded options without saving controls", () => {
    const html = render({
      kind: "draft_proposal",
      proposal: {
        id: "draft_proposal:person-1:warm",
        personId: "person-1",
        personDisplayName: "Maya",
        channel: "text",
        purpose: "check_in",
        variants: [
          {
            id: "variant-1",
            label: "Warm",
            toneInstruction: "warm",
            body: "Hi Maya, thinking about your move to Denver.",
          },
        ],
        sourceRefs: [
          {
            kind: "approved_memory",
            id: "memory-1",
            label: "Maya moved to Denver.",
            trust: "confirmed_fact",
          },
        ],
        ephemeral: true,
        persistenceRequiresExplicitOwnerIntent: true,
      },
      skippedReason: null,
    });

    expect(html).toContain("Draft options for Maya");
    expect(html).toContain("Warm");
    expect(html).toContain("Hi Maya, thinking about your move to Denver.");
    expect(html).toContain("Memory: Maya moved to Denver.");
    expect(html).toContain("Draft Proposal only");
    expect(html).toContain("not saved as a Tendnote draft");
    expect(html).toContain('data-tool-view="draft_proposal"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Gmail");
  });

  it("renders skipped Draft Proposals as a quiet line", () => {
    const html = render({
      kind: "draft_proposal",
      proposal: null,
      skippedReason: "insufficient_context",
    });

    expect(html).toContain("No draft options: not enough grounded context");
    expect(html).not.toContain('data-tool-view="draft_proposal"');
  });

  it("renders an unknown tool result as a quiet ambient line", () => {
    const html = render({ kind: "generic", toolName: "some_future_tool" });

    // The humanized name carries it; no card chrome and no redundant "Done".
    expect(html).toContain("some future tool");
    expect(html).not.toContain('data-tool-view="generic"');
  });
});
