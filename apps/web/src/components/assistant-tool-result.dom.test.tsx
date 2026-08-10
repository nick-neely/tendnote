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
