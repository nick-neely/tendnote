// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";
import { renderExpanded } from "@/test/expanded-markup";

vi.mock("next/link", () => import("@/test/next-link-mock"));

import { AssistantToolResult } from "./assistant-tool-result";

function render(view: AssistantToolView): string {
  return renderExpanded(<AssistantToolResult view={view} />);
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
    expect(html).toContain("Not a confirmed fact");
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
    // Snapshot freshness reads in plain language, not "snapshot: fresh" mono jargon.
    expect(html).toContain("up to date");
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

    expect(html).toContain("Nothing matching in your notebook");
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
    expect(html).toContain("Only me");
    expect(html).not.toContain("Confirmed fact");
    expect(html).toContain('href="/people/person-1"');
  });

  it("renders an exact recall Action as an Action, deep-linked to its ledger row", () => {
    // General Actions are ordinary recall results (ADR 0150). The card used to reject
    // the whole result set rather than name one, so this pins both the naming and the
    // destination: an Action opens its ledger row, not a person it merely mentions.
    const html = render({
      kind: "relationship_context_search",
      results: [
        {
          recordKind: "general_action",
          recordId: "ga-1",
          visibilityChoice: "only_me",
          visibilityLabel: "Only me",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Replace the fridge water filter",
          snippet: "Replace the fridge water filter",
          matchedFields: ["title"],
          trustLevel: "action_item",
          sensitivity: "normal",
        },
      ],
    });

    expect(html).toContain("Replace the fridge water filter");
    expect(html).toContain("Action");
    expect(html).toContain("On your list");
    expect(html).toContain('href="/actions#action-ga-1"');
    expect(html).not.toContain('href="/people/person-1"');
    expect(html).not.toContain("Confirmed fact");
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
    expect(html).toContain("Only me");
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
    expect(html).toContain("Only me");
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

  it("renders Global Recall rows with the same deep links the search surfaces open", () => {
    const html = render({
      kind: "global_recall",
      query: "fridge filter",
      results: [
        {
          family: "general_action",
          canonicalKind: "general_action",
          canonicalId: "ga-1",
          href: "/actions#action-ga-1",
          primary: "Replace the fridge water filter",
          secondary: "Open",
          matchKind: "exact",
          visibilityLabel: "Only me",
          sensitivity: "normal",
        },
        {
          family: "asset_memory",
          canonicalKind: "asset_memory",
          canonicalId: "memory-1",
          href: "/assets/asset-1#asset-memory-memory-1",
          primary: "Filter size",
          secondary: "RPWFE",
          matchKind: "related",
          visibilityLabel: "Whole household",
          sensitivity: "sensitive",
        },
      ],
      limitations: ["Calendar results are unavailable."],
      hasMore: true,
    });

    expect(html).toContain("Found 2 matches across your records");
    expect(html).toContain('href="/actions#action-ga-1"');
    expect(html).toContain('href="/assets/asset-1#asset-memory-memory-1"');
    // Family names come from the shared recall labels, so a row is called the same
    // thing here as in the palette.
    expect(html).toContain("Actions");
    expect(html).toContain("Asset details");
    expect(html).toContain("Related");
    expect(html).toContain("Sensitive");
    // What recall could not reach is part of the answer, not a detail the card drops.
    expect(html).toContain("Calendar results are unavailable.");
    expect(html).toContain("More matches than fit here.");
    expect(html).toContain('data-tool-view="global_recall"');
  });

  it("renders an empty, unqualified Global Recall as a quiet line", () => {
    const html = render({
      kind: "global_recall",
      query: "nothing here",
      results: [],
      limitations: [],
      hasMore: false,
    });

    expect(html).toContain("Nothing matching in your records");
    expect(html).not.toContain('data-tool-view="global_recall"');
  });

  it("keeps a limitation visible even when Global Recall found nothing", () => {
    // "Nothing matched" and "nothing matched, and the calendar was unreachable" are
    // different answers; collapsing the second to the first would hide the caveat.
    const html = render({
      kind: "global_recall",
      query: "dentist",
      results: [],
      limitations: ["Calendar results are unavailable."],
      hasMore: false,
    });

    expect(html).toContain("Calendar results are unavailable.");
    expect(html).toContain('data-tool-view="global_recall"');
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

    expect(html).toContain("No draft options: not enough saved context yet");
    expect(html).not.toContain('data-tool-view="draft_proposal"');
  });

  it("renders a created General Action as a confirmed card with its timing summary", () => {
    const html = render({
      kind: "created_general_action",
      generalActionId: "ga-1",
      title: "Replace the fridge water filter",
      status: "open",
      isRoutine: false,
      recurrenceLabel: null,
      timingLabel: "Due Jul 15, 2026",
      personNames: ["Priya Shah"],
      visibilityLabel: "Only me",
    });

    expect(html).toContain("Added to your actions");
    expect(html).toContain("Replace the fridge water filter");
    expect(html).toContain("Due Jul 15, 2026");
    expect(html).toContain("With Priya Shah");
    expect(html).toContain("Only me");
    expect(html).toContain('data-tool-view="created_general_action"');
    // Deep-links the exact new ledger row rather than the top of the list.
    expect(html).toContain('href="/actions#action-ga-1"');
    expect(html).toContain("Open in Actions");
    // The id appears only inside that deep-link href — never as visible card content.
    expect(html.split("ga-1")).toHaveLength(2);
  });

  it("renders a created Routine with its cadence and the routine label", () => {
    const html = render({
      kind: "created_general_action",
      generalActionId: "ga-2",
      title: "Change the furnace filter",
      status: "open",
      isRoutine: true,
      recurrenceLabel: "Every 6 months",
      timingLabel: null,
      personNames: [],
      visibilityLabel: "Only me",
    });

    expect(html).toContain("Added a routine");
    expect(html).toContain("Every 6 months");
  });

  it("renders a concrete reminder and an honest partial scheduling failure", () => {
    const scheduled = render({
      kind: "created_general_action",
      generalActionId: "ga-3",
      title: "Replace the fridge water filter",
      status: "open",
      isRoutine: false,
      recurrenceLabel: null,
      timingLabel: "Due Aug 16, 2026",
      personNames: [],
      visibilityLabel: "Only me",
      reminderStatus: "scheduled",
      reminderLabel: "Reminder at 15:00 · America/Chicago",
    });
    expect(scheduled).toContain("Reminder at 15:00 · America/Chicago");

    const failed = render({
      kind: "created_general_action",
      generalActionId: "ga-4",
      title: "Replace the fridge water filter",
      status: "open",
      isRoutine: false,
      recurrenceLabel: null,
      timingLabel: "Due Aug 16, 2026",
      personNames: [],
      visibilityLabel: "Only me",
      reminderStatus: "failed",
      reminderLabel: "Action saved; reminder not scheduled",
    });
    expect(failed).toContain("Action saved; reminder not scheduled");
  });

  it("renders a General Action ledger list as an expandable list without raw ids", () => {
    const html = render({
      kind: "general_action_list",
      ledger: "active",
      window: "this_week",
      actions: [
        {
          generalActionId: "ga-1",
          title: "Rotate the tires",
          status: "deferred",
          isRoutine: false,
          recurrenceLabel: null,
          timingLabel: "Set aside until Jul 20, 2026",
          personNames: [],
          visibilityLabel: "Only me",
        },
        {
          generalActionId: "ga-2",
          title: "Change the furnace filter",
          status: "open",
          isRoutine: true,
          recurrenceLabel: "Every 6 months",
          timingLabel: null,
          personNames: ["Sam"],
          visibilityLabel: "Whole household",
        },
      ],
    });

    expect(html).toContain("2 actions");
    expect(html).toContain("Rotate the tires");
    expect(html).toContain("Set aside until Jul 20, 2026");
    expect(html).toContain("Change the furnace filter");
    expect(html).toContain("Every 6 months");
    // Raw enum statuses are humanized for the chip.
    expect(html).toContain("Set aside");
    expect(html).toContain("Whole household");
    expect(html).toContain('data-tool-view="general_action_list"');
    expect(html).not.toContain("ga-1");
    expect(html).not.toContain("ga-2");
  });

  it("renders an empty General Action ledger list as a quiet line", () => {
    const html = render({
      kind: "general_action_list",
      ledger: "active",
      window: null,
      actions: [],
    });

    expect(html).toContain("Nothing on your active list");
    expect(html).not.toContain('data-tool-view="general_action_list"');
  });

  it("renders an unknown tool result as a quiet ambient line", () => {
    const html = render({ kind: "generic", toolName: "some_future_tool" });

    // The humanized name carries it; no card chrome and no redundant "Done".
    expect(html).toContain("some future tool");
    expect(html).not.toContain('data-tool-view="generic"');
  });

  it("renders a malformed known-tool result as a visibly degraded line, not routine housekeeping", () => {
    const benign = render({ kind: "generic", toolName: "capture_memory" });
    const malformed = render({ kind: "generic", toolName: "capture_memory", malformed: true });

    // A possibly-failed save is called out, not disguised as a quiet lookup…
    // (renderToStaticMarkup escapes the apostrophe, so assert the apostrophe-free part.)
    expect(malformed).toContain("capture memory");
    expect(malformed).toContain("return a readable result");
    // …and it reads differently from the benign fallback for the same tool name.
    expect(malformed).not.toBe(benign);
    expect(benign).not.toContain("return a readable result");
  });

  it("renders a well-formed negative outcome as an honest neutral line, never an alarm", () => {
    const note = render({
      kind: "generic",
      toolName: "create_message_draft",
      note: "No draft was created",
    });
    const malformed = render({
      kind: "generic",
      toolName: "create_message_draft",
      malformed: true,
    });

    // The honest copy is shown plainly — no "didn't return a readable result" alarm, no
    // raw tool name — and it reads differently from the degraded malformed treatment.
    expect(note).toContain("No draft was created");
    expect(note).not.toContain("return a readable result");
    expect(note).not.toContain("create message draft");
    expect(note).not.toBe(malformed);
  });

  it("renders search_assets matches as a disclosure with exact values and no raw ids", () => {
    const html = render({
      kind: "asset_search",
      query: "fridge filter",
      results: [
        {
          recordKind: "asset_memory",
          recordId: "memory-1",
          assetId: "asset-1",
          assetName: "Kitchen refrigerator",
          label: "Filter model",
          snippet: "The filter is EDR1RXD1.",
          value: "EDR1RXD1",
          matchKinds: ["structured", "exact"],
          trustLevel: "asset_fact",
          visibilityLabel: "Only me",
          ownership: "member_owned",
        },
      ],
    });

    expect(html).toContain("1 match on your things");
    expect(html).toContain("Kitchen refrigerator");
    expect(html).toContain("EDR1RXD1");
    expect(html).toContain('data-tool-view="asset_search"');
    // The persisted record id stays out of the rendered output entirely; the asset id
    // appears only inside the navigation href, never as visible card content.
    expect(html).not.toContain("memory-1");
    expect(html).toContain('href="/assets/asset-1"');
    expect(html.split("asset-1")).toHaveLength(2);
  });

  it("states the trust register but no audience on a household-native search row", () => {
    // Nobody chose to share the household's own refrigerator with the household, so
    // the row must not say so — and it must not leave the separator dangling either
    // (ADR 0214). The chat card was the last Asset Search surface still naming one.
    const html = render({
      kind: "asset_search",
      query: "fridge",
      results: [
        {
          recordKind: "asset",
          recordId: "asset-1",
          assetId: "asset-1",
          assetName: "Kitchen refrigerator",
          label: "Kitchen refrigerator",
          snippet: "Kitchen refrigerator",
          value: null,
          matchKinds: ["exact"],
          trustLevel: "asset_anchor",
          visibilityLabel: "Whole household",
          ownership: "household_native",
        },
      ],
    });

    expect(html).toContain("Asset");
    expect(html).toContain("Exact text");
    expect(html).not.toContain("Whole household");
    expect(html).not.toMatch(/Exact text\s*(·|&middot;|\u00b7)\s*</);
  });

  it("renders an empty search_assets result as a quiet line", () => {
    const html = render({ kind: "asset_search", query: "nothing", results: [] });

    expect(html).toContain("Nothing found on your things");
    expect(html).not.toContain('data-tool-view="asset_search"');
  });

  it("renders a fresh asset context leading with facts and labeling the summary as a cache", () => {
    const html = render({
      kind: "asset_context",
      found: true,
      assetName: "Kitchen refrigerator",
      snapshotStatus: "fresh",
      summary: "A kitchen fridge; the filter is EDR1RXD1.",
      facts: [
        {
          memoryId: "mem-raw-id-1",
          label: "Filter model",
          value: "EDR1RXD1",
          notes: null,
          visibilityLabel: "Only me",
          ownership: "member_owned",
        },
      ],
      evidence: [{ evidenceId: "e1", kind: "photo", label: "Filter photo" }],
      actions: [{ actionId: "a1", title: "Replace filter", status: "open", dueAt: null }],
    });

    expect(html).toContain("Kitchen refrigerator");
    expect(html).toContain("Filter model");
    expect(html).toContain("EDR1RXD1");
    expect(html).toContain("1 confirmed fact");
    // The generated summary is present but explicitly framed as derived, not truth.
    expect(html).toContain("not a source of truth");
    expect(html).toContain("A kitchen fridge; the filter is EDR1RXD1.");
    expect(html).toContain('data-tool-view="asset_context"');
    // The raw record id must never surface in the rendered card (a distinctive
    // sentinel avoids colliding with incidental substrings in icon SVG paths).
    expect(html).not.toContain("mem-raw-id-1");
  });

  it("never renders a stale (nulled) asset-context summary, and flags it unavailable", () => {
    const html = render({
      kind: "asset_context",
      found: true,
      assetName: "Kitchen refrigerator",
      snapshotStatus: "fallback",
      summary: null,
      facts: [
        {
          memoryId: "m1",
          label: "Filter model",
          value: "EDR1RXD1",
          notes: null,
          visibilityLabel: "Only me",
          ownership: "member_owned",
        },
      ],
      evidence: [],
      actions: [],
    });

    // The reviewed fact stands; no summary block, and the footer says so.
    expect(html).toContain("EDR1RXD1");
    expect(html).not.toContain("not a source of truth");
    expect(html).toContain("summary unavailable");
  });

  it("names no audience on a household-native asset's own fact", () => {
    const html = render({
      kind: "asset_context",
      found: true,
      assetName: "Kitchen refrigerator",
      snapshotStatus: "fresh",
      summary: null,
      facts: [
        {
          memoryId: "m1",
          label: "Filter model",
          value: "EDR1RXD1",
          notes: null,
          visibilityLabel: "Whole household",
          ownership: "household_native",
        },
      ],
      evidence: [],
      actions: [],
    });

    expect(html).toContain("Filter model");
    expect(html).toContain("EDR1RXD1");
    expect(html).not.toContain("Whole household");
  });

  it("renders a household check-in as a card of canonical rows, naming the household", () => {
    const html = render({
      kind: "household_check_in",
      householdName: "Ash Lane",
      optedIn: true,
      limitations: [],
      records: [
        {
          recordId: "action-1",
          family: "routine",
          href: "/actions#action-1",
          title: "Put the bins out",
          context: "Routine · Every week",
          timing: "Due today.",
          scopeLabel: "Household",
          responsibility: "Mara is looking after this",
        },
      ],
    });

    expect(html).toContain("Household check-in");
    expect(html).toContain("Put the bins out");
    expect(html).toContain('href="/actions#action-1"');
    // Every fact in text, and the boundary said in words on the card itself.
    expect(html).toContain("Due today.");
    expect(html).toContain("Household");
    expect(html).toContain("Mara is looking after this");
    expect(html).toContain("as you can see it");
    // Read-first: the card offers no inline mutation at all.
    expect(html).not.toContain("<button");
  });

  it("tells a quiet household apart from a failed read and from no opt-in", () => {
    // The whole reason these are typed rather than a generic dot: three different
    // absences that must not look identical.
    const quiet = render({
      kind: "household_check_in",
      householdName: "Ash Lane",
      optedIn: true,
      limitations: [],
      records: [],
    });
    const failed = render({
      kind: "household_check_in",
      householdName: "Ash Lane",
      optedIn: true,
      limitations: ["The check-in is temporarily unavailable."],
      records: [],
    });
    const notOptedIn = render({
      kind: "household_check_in",
      householdName: null,
      optedIn: false,
      limitations: [],
      records: [],
    });

    expect(quiet).toContain("Nothing timely in Ash Lane");
    expect(failed).toContain("temporarily unavailable");
    expect(notOptedIn).toContain("No household check-in on your brief");
    // "Nothing is going on" and "we could not look" never share wording.
    expect(quiet).not.toContain("unavailable");
    expect(failed).not.toContain("Nothing timely");
  });

  it("renders gift plans with the reader's own standing and nobody else's audience", () => {
    const html = render({
      kind: "gift_plan_search",
      query: "Rowan",
      plans: [
        {
          giftPlanId: "plan-1",
          subjectName: "Rowan",
          occasion: "Fortieth birthday",
          occasionOn: "2026-09-14T00:00:00.000Z",
          status: "active",
          ideaCount: 3,
          claimedIdeaCount: 1,
          isOwner: false,
        },
      ],
    });

    expect(html).toContain("Rowan");
    expect(html).toContain("Fortieth birthday");
    expect(html).toContain("3 ideas");
    expect(html).toContain("1 claimed");
    // The authority fact is about the reader, so an absent control is explained.
    expect(html).toContain("Shared with you");
    expect(html).toContain('href="/gift-plans/plan-1"');
  });

  it("renders an empty gift-plan search as plain absence, with nothing to hedge from", () => {
    // What a Surprise Subject sees. It must read exactly like what someone with no
    // plans at all sees — no hedge, no hint, no "hidden" (ADR 0216).
    const html = render({ kind: "gift_plan_search", query: "Rowan", plans: [] });

    expect(html).toContain("No gift plans");
    // Text only: `aria-hidden` on a decorative glyph is not a word the user reads.
    const text = html.replace(/<[^>]*>/g, " ");
    expect(text).not.toMatch(/hidden|withheld|surprise|can't show|cannot show/i);
  });

  it("renders the audience a capture actually wrote with, not the one Eve described", () => {
    const household = render({
      kind: "capture_outcome",
      destination: "Saved Items",
      outcomes: [{ destination: "Saved Items", visibility: "Household" }],
    });
    const private_ = render({
      kind: "capture_outcome",
      destination: "Saved Items",
      outcomes: [{ destination: "Saved Items", visibility: "Only me" }],
    });

    // The privacy-consequential fork, readable rather than paraphrased.
    expect(household).toContain("Household");
    expect(private_).toContain("Only me");
    expect(household).not.toContain("Only me");
  });

  it("renders a not-found asset context as a quiet line", () => {
    const html = render({
      kind: "asset_context",
      found: false,
      assetName: null,
      snapshotStatus: null,
      summary: null,
      facts: [],
      evidence: [],
      actions: [],
    });

    expect(html).toContain("No such asset");
    expect(html).not.toContain('data-tool-view="asset_context"');
  });
});
