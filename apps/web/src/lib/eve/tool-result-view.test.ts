import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatSurfacingDay, RENDERED_TOOL_NAMES } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  assistantToolViewKey,
  relationshipAgendaCandidateKey,
  toAssistantToolView,
  toolViewTier,
} from "@/components/assistant-results/registry";
import { activeToolLabel, completedToolLabel } from "./active-tool-label";

describe("toAssistantToolView (Eve tool output → renderable view)", () => {
  it("renders a capture_source_record result as logged context with its persisted id", () => {
    const view = toAssistantToolView({
      toolName: "capture_source_record",
      output: {
        sourceRecord: { id: "source-1", status: "active", content: "Had lunch with Mark." },
        linkedPersonId: "person-1",
        component: { type: "source_record_review", sourceRecordId: "source-1" },
      },
    });

    expect(view).toEqual({
      kind: "saved_source_record",
      sourceRecordId: "source-1",
      content: "Had lunch with Mark.",
      linkedPersonId: "person-1",
    });
  });

  it("renders a capture_memory result as a saved memory grounded in its source record", () => {
    const view = toAssistantToolView({
      toolName: "capture_memory",
      output: {
        memory: {
          id: "memory-1",
          personId: "person-1",
          content: "Caleb is moving to Denver in August.",
          status: "approved",
          sourceRecordId: "source-1",
        },
        person: { id: "person-1", displayName: "Caleb" },
        component: {
          type: "memory_saved",
          memoryId: "memory-1",
          sourceRecordId: "source-1",
          personId: "person-1",
        },
      },
    });

    expect(view).toEqual({
      kind: "saved_memory",
      memoryId: "memory-1",
      sourceRecordId: "source-1",
      personId: "person-1",
      personName: "Caleb",
      content: "Caleb is moving to Denver in August.",
    });
  });

  it("renders a create_person result as an added person", () => {
    const view = toAssistantToolView({
      toolName: "create_person",
      output: {
        person: { id: "person-9", displayName: "Mara Lin", relationshipType: "friend" },
        component: { type: "person_created", personId: "person-9" },
      },
    });

    expect(view).toEqual({
      kind: "added_person",
      personId: "person-9",
      displayName: "Mara Lin",
      relationshipType: "friend",
    });
  });

  it("renders an update_person result as an updated person with the changed fields", () => {
    const view = toAssistantToolView({
      toolName: "update_person",
      output: {
        updated: true,
        person: { id: "person-9", displayName: "Mara Lin", relationshipType: "colleague" },
        updatedFields: ["displayName", "birthday"],
        component: { type: "person_updated", personId: "person-9" },
      },
    });

    expect(view).toEqual({
      kind: "updated_person",
      personId: "person-9",
      displayName: "Mara Lin",
      relationshipType: "colleague",
      updatedFields: ["displayName", "birthday"],
    });
  });

  it("renders a well-formed update_person no-op as an honest neutral line, not an error", () => {
    const view = toAssistantToolView({
      toolName: "update_person",
      output: { updated: false, component: { type: "person_update_failed", personId: "person-9" } },
    });

    // `updated: false` is a recognized negative (the schema pins `updated` to true), so
    // it is an honest "nothing happened" — a neutral note, never the malformed alarm.
    expect(view).toEqual({
      kind: "generic",
      toolName: "update_person",
      note: "No changes were needed",
    });
  });

  it("renders a get_person_context result with per-tier counts and snapshot status", () => {
    const view = toAssistantToolView({
      toolName: "get_person_context",
      output: {
        found: true,
        person: { id: "person-1", displayName: "Mark", relationshipType: "friend" },
        snapshotStatus: "fresh",
        approvedMemories: [{ id: "m1" }],
        sourceRecords: [{ id: "s1" }, { id: "s2" }],
        suggestedMemories: [{ id: "sug1" }],
        component: { type: "person_context", personId: "person-1", snapshotStatus: "fresh" },
      },
    });

    expect(view).toEqual({
      kind: "person_context",
      personId: "person-1",
      personName: "Mark",
      snapshotStatus: "fresh",
      approvedCount: 1,
      loggedCount: 2,
      suggestedCount: 1,
    });
  });

  it("renders a get_suggested_memory_review result as a tentative review item", () => {
    const view = toAssistantToolView({
      toolName: "get_suggested_memory_review",
      output: {
        found: true,
        person: { id: "person-1", displayName: "Mark" },
        memory: {
          id: "memory-2",
          personId: "person-1",
          content: "Maybe switching jobs.",
          status: "suggested",
          sourceRecordId: "source-2",
        },
        sourceRecord: { id: "source-2", content: "Mark mentioned a recruiter." },
        component: { type: "suggested_memory_review", memoryId: "memory-2" },
      },
    });

    expect(view).toEqual({
      kind: "suggested_memory_review",
      memoryId: "memory-2",
      content: "Maybe switching jobs.",
      sourceRecordId: "source-2",
      personId: "person-1",
      personName: "Mark",
    });
  });

  it("maps a list_suggested_memory_reviews result into one review item per suggestion", () => {
    const view = toAssistantToolView({
      toolName: "list_suggested_memory_reviews",
      output: {
        found: true,
        personId: "person-1",
        count: 2,
        reviews: [
          {
            person: { id: "person-1", displayName: "Mara" },
            memory: { id: "m1", content: "Girls night next week.", sourceRecordId: "s1" },
          },
          {
            person: { id: "person-2", displayName: "Mark" },
            memory: { id: "m2", content: "New manager at work.", sourceRecordId: null },
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "suggested_memory_review_list",
      reviews: [
        {
          memoryId: "m1",
          content: "Girls night next week.",
          sourceRecordId: "s1",
          personId: "person-1",
          personName: "Mara",
        },
        {
          memoryId: "m2",
          content: "New manager at work.",
          sourceRecordId: null,
          personId: "person-2",
          personName: "Mark",
        },
      ],
    });
  });

  it("renders Memory Curator proposals as grounded review-only assistant cards", () => {
    const view = toAssistantToolView({
      toolName: "propose_memory_cleanup",
      output: {
        ownerUserId: "owner-1",
        proposals: [
          {
            id: "duplicate_memory:memory-1:memory-2",
            kind: "duplicate_memory",
            ownerUserId: "owner-1",
            personId: "person-1",
            personDisplayName: "Maya",
            title: "Possible duplicate memory for Maya",
            reason: "Two approved memories have the same normalized content.",
            suggestedAction:
              "Review both memories and decide whether one should be archived or rewritten.",
            sourceRefs: [
              { kind: "memory", id: "memory-1", label: "Maya lives in Austin." },
              { kind: "memory", id: "memory-2", label: "Maya lives in Austin." },
            ],
            sensitivity: "normal",
            reviewOnly: true,
          },
        ],
        component: { type: "memory_curator_proposals", proposalCount: 1 },
      },
    });

    expect(view).toEqual({
      kind: "memory_curator_proposals",
      proposals: [
        {
          id: "duplicate_memory:memory-1:memory-2",
          proposalKind: "duplicate_memory",
          personId: "person-1",
          personDisplayName: "Maya",
          title: "Possible duplicate memory for Maya",
          reason: "Two approved memories have the same normalized content.",
          suggestedAction:
            "Review both memories and decide whether one should be archived or rewritten.",
          sourceRefs: [
            { kind: "memory", id: "memory-1", label: "Maya lives in Austin." },
            { kind: "memory", id: "memory-2", label: "Maya lives in Austin." },
          ],
          sensitivity: "normal",
          reviewOnly: true,
        },
      ],
    });
  });

  const dueDate = new Date("2026-07-15T00:00:00.000Z");
  const dueLabel = `Was due ${formatSurfacingDay(dueDate, new Date())}`;

  it("renders a get_suggested_followup_review result as a tentative follow-up item", () => {
    const view = toAssistantToolView({
      toolName: "get_suggested_followup_review",
      output: {
        found: true,
        component: { type: "suggested_followup_review", followupId: "f1", sourceRecordId: "s1" },
        person: { id: "person-1", displayName: "Mark" },
        followup: {
          id: "f1",
          personId: "person-1",
          reason: "Check in about the new job.",
          dueAt: "2026-07-15T00:00:00.000Z",
        },
        sourceRecord: { id: "s1" },
      },
    });

    expect(view).toEqual({
      kind: "suggested_followup_review",
      followupId: "f1",
      reason: "Check in about the new job.",
      timingLabel: dueLabel,
      sourceRecordId: "s1",
      personId: "person-1",
      personName: "Mark",
    });
  });

  it("renders a propose_followup result as a tentative follow-up review item", () => {
    const view = toAssistantToolView({
      toolName: "propose_followup",
      output: {
        found: true,
        component: { type: "suggested_followup_review", followupId: "f9", sourceRecordId: "s9" },
        person: { id: "person-1", displayName: "Mark" },
        followup: {
          id: "f9",
          personId: "person-1",
          reason: "Ask how the move went.",
          dueAt: "2026-07-15T00:00:00.000Z",
        },
        sourceRecord: { id: "s9" },
      },
    });

    expect(view).toEqual({
      kind: "suggested_followup_review",
      followupId: "f9",
      reason: "Ask how the move went.",
      timingLabel: dueLabel,
      sourceRecordId: "s9",
      personId: "person-1",
      personName: "Mark",
    });
  });

  it("maps a list_suggested_followup_reviews result into one item per suggestion", () => {
    const view = toAssistantToolView({
      toolName: "list_suggested_followup_reviews",
      output: {
        found: true,
        reviews: [
          {
            person: { id: "person-1", displayName: "Mark" },
            followup: { id: "f1", reason: "Reconnect.", dueAt: "2026-07-15T00:00:00.000Z" },
            sourceRecord: { id: "s1" },
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "suggested_followup_review_list",
      reviews: [
        {
          followupId: "f1",
          reason: "Reconnect.",
          timingLabel: dueLabel,
          sourceRecordId: "s1",
          personId: "person-1",
          personName: "Mark",
        },
      ],
    });
  });

  it("renders exact recall person results as compact typed references", () => {
    const view = toAssistantToolView({
      toolName: "search_relationship_context",
      output: {
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
            rank: 1.2,
            trustLevel: "identity_reference",
            sensitivity: "normal",
          },
        ],
        component: { type: "relationship_context_search", resultCount: 1 },
      },
    });

    expect(view).toEqual({
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
  });

  it("keeps exact recall output compact and ignores full profiles or snapshot prose", () => {
    const view = toAssistantToolView({
      toolName: "search_relationship_context",
      output: {
        results: [
          {
            recordKind: "memory",
            recordId: "memory-1",
            visibilityChoice: "selected_members",
            visibilityLabel: "Specific people",
            relatedPersonId: "person-1",
            relatedPersonDisplayName: "Mara Lin",
            label: "Mara Lin",
            snippet: "Mara prefers backend architecture conversations.",
            matchedFields: ["content"],
            rank: 1.2,
            trustLevel: "confirmed_fact",
            sensitivity: "normal",
            fullProfile: "Do not render this.",
            snapshot: { summary: "Generated snapshot prose." },
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "relationship_context_search",
      results: [
        {
          recordKind: "memory",
          recordId: "memory-1",
          visibilityChoice: "selected_members",
          visibilityLabel: "Specific people",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Mara prefers backend architecture conversations.",
          matchedFields: ["content"],
          trustLevel: "confirmed_fact",
          sensitivity: "normal",
        },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("Generated snapshot prose");
    expect(JSON.stringify(view)).not.toContain("Do not render this");
    expect(JSON.stringify(view)).not.toContain("household-1");
  });

  it("renders semantic recall results as compact grounded references", () => {
    const view = toAssistantToolView({
      toolName: "search_semantic_context",
      output: {
        results: [
          {
            recordKind: "source_record",
            recordId: "source-1",
            visibilityChoice: "whole_household",
            visibilityLabel: "Whole household",
            relatedPersonId: "person-1",
            relatedPersonDisplayName: "Mara Lin",
            snippet: "Mara mentioned a possible career change.",
            similarity: 0.89,
            trustLevel: "logged_context",
            sensitivity: "sensitive",
            sourceRefs: [{ kind: "source_record", id: "source-1" }],
            routing: { personId: "person-1", recordKind: "source_record", recordId: "source-1" },
            generatedAnswer: "Do not render this.",
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "semantic_context_search",
      results: [
        {
          recordKind: "source_record",
          recordId: "source-1",
          visibilityChoice: "whole_household",
          visibilityLabel: "Whole household",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          snippet: "Mara mentioned a possible career change.",
          similarity: 0.89,
          trustLevel: "logged_context",
          sensitivity: "sensitive",
        },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("generatedAnswer");
  });

  it("keeps a General Action row from costing the rest of an exact recall card", () => {
    // The card contract excluded `general_action`/`action_item`, so one Action in a
    // result set failed the parse and the *whole* card degraded to a malformed line
    // — every other row lost with it (ADR 0150).
    const row = (recordKind: string, recordId: string, trustLevel: string, label: string) => ({
      recordKind,
      recordId,
      visibilityChoice: "only_me",
      visibilityLabel: "Only me",
      relatedPersonId: null,
      relatedPersonDisplayName: null,
      label,
      snippet: label,
      matchedFields: ["title"],
      rank: 1,
      trustLevel,
      sensitivity: "normal",
    });

    const view = toAssistantToolView({
      toolName: "search_relationship_context",
      output: {
        results: [
          row("memory", "memory-1", "confirmed_fact", "Mara prefers backend work."),
          row("general_action", "ga-1", "action_item", "Replace the fridge water filter"),
        ],
      },
    });

    expect(view.kind).toBe("relationship_context_search");
    expect(view.kind === "relationship_context_search" && view.results).toHaveLength(2);
    expect(view.kind === "relationship_context_search" && view.results[1]).toMatchObject({
      recordKind: "general_action",
      recordId: "ga-1",
      trustLevel: "action_item",
    });
  });

  it("keeps a General Action row from costing the rest of a semantic recall card", () => {
    const view = toAssistantToolView({
      toolName: "search_semantic_context",
      output: {
        results: [
          {
            recordKind: "general_action",
            recordId: "ga-1",
            visibilityChoice: "only_me",
            visibilityLabel: "Only me",
            relatedPersonId: null,
            relatedPersonDisplayName: null,
            snippet: "Replace the fridge water filter",
            similarity: 0.71,
            trustLevel: "action_item",
            sensitivity: "normal",
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "semantic_context_search",
      results: [
        {
          recordKind: "general_action",
          recordId: "ga-1",
          visibilityChoice: "only_me",
          visibilityLabel: "Only me",
          relatedPersonId: null,
          relatedPersonDisplayName: null,
          snippet: "Replace the fridge water filter",
          similarity: 0.71,
          trustLevel: "action_item",
          sensitivity: "normal",
        },
      ],
    });
  });

  it("renders Global Recall on its own rows, keeping each result's deep link and caveats", () => {
    const view = toAssistantToolView({
      toolName: "search_global_recall",
      output: {
        query: "fridge filter",
        results: [
          {
            family: "general_action",
            canonical: { kind: "general_action", id: "ga-1" },
            label: "Replace the fridge water filter",
            supportingText: "Open",
            lifecycle: "open",
            match: { kind: "exact", reason: "Matched title", excerpt: "fridge filter" },
            trust: "action_item",
            sensitivity: "normal",
            visibility: { choice: "only_me", label: "Only me" },
            grounding: [{ kind: "general_action", id: "ga-1" }],
            href: "/actions#action-ga-1",
            parent: null,
            details: { status: "open", isRoutine: false, isSuggested: false, areaId: null },
          },
          {
            family: "relationship_context",
            canonical: { kind: "memory", id: "memory-1" },
            label: "Mara Lin",
            supportingText: "Mara replaced her own filter last spring.",
            lifecycle: "active",
            match: { kind: "related", reason: "Related by meaning", excerpt: null },
            trust: "confirmed_fact",
            sensitivity: "sensitive",
            visibility: { choice: "only_me", label: "Only me" },
            grounding: [{ kind: "memory", id: "memory-1" }],
            href: "/people/person-1#memory-memory-1",
            parent: { kind: "person", id: "person-1" },
            details: { contextKind: "memory", personDisplayName: "Mara Lin" },
          },
        ],
        limitations: [{ source: "calendar", message: "Calendar results are unavailable." }],
        hasMore: true,
        component: { type: "global_recall", resultCount: 2 },
      },
    });

    expect(view).toEqual({
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
          family: "relationship_context",
          canonicalKind: "memory",
          canonicalId: "memory-1",
          href: "/people/person-1#memory-memory-1",
          // A memory row leads with what was remembered and lets the person be the
          // context beneath it — the same rule the palette and phone flow read.
          primary: "Mara replaced her own filter last spring.",
          secondary: "Mara Lin",
          matchKind: "related",
          visibilityLabel: "Only me",
          sensitivity: "sensitive",
        },
      ],
      limitations: ["Calendar results are unavailable."],
      hasMore: true,
    });
  });

  it("renders relationship agenda results as compact typed candidates", () => {
    const view = toAssistantToolView({
      toolName: "get_relationship_agenda",
      output: {
        candidates: [
          {
            kind: "due_followup",
            personId: "person-1",
            personDisplayName: "Mara Lin",
            title: "Follow up with Mara Lin",
            reason: "Ask about the move.",
            dueAt: "2026-07-02T12:00:00.000Z",
            sourceRefs: [{ kind: "followup", id: "followup-1" }],
            trustLevel: "active_reminder",
            sensitivity: "normal",
            visibilityChoice: "selected_members",
            visibilityLabel: "Specific people",
            rank: 1,
          },
          {
            kind: "suggested_followup",
            personId: "person-1",
            personDisplayName: "Mara Lin",
            title: "Review suggested follow-up for Mara Lin",
            reason: "Ask whether the move happened.",
            dueAt: "2026-07-04T12:00:00.000Z",
            sourceRefs: [
              { kind: "followup", id: "followup-2" },
              { kind: "source_record", id: "source-1" },
            ],
            trustLevel: "tentative",
            sensitivity: "sensitive",
            rank: 2,
          },
        ],
        component: { type: "relationship_agenda", resultCount: 2 },
      },
    });

    const dueLabel = new Date("2026-07-02T12:00:00.000Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    expect(view).toEqual({
      kind: "relationship_agenda",
      candidates: [
        {
          kind: "due_followup",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Follow up with Mara Lin",
          reason: "Ask about the move.",
          dueAt: "2026-07-02T12:00:00.000Z",
          dueLabel,
          sourceRefs: [{ kind: "followup", id: "followup-1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          visibilityChoice: "selected_members",
          visibilityLabel: "Specific people",
          rank: 1,
        },
        expect.objectContaining({
          kind: "suggested_followup",
          personDisplayName: "Mara Lin",
          trustLevel: "tentative",
          sensitivity: "sensitive",
        }),
      ],
      window: null,
    });
  });

  it("echoes the requested agenda window so the calendar can highlight it", () => {
    const view = toAssistantToolView({
      toolName: "get_relationship_agenda",
      output: {
        candidates: [],
        window: { start: "2026-07-01T00:00:00Z", end: "2026-07-07T23:59:59Z" },
        component: { type: "relationship_agenda", resultCount: 0 },
      },
    });

    expect(view).toEqual({
      kind: "relationship_agenda",
      candidates: [],
      window: { start: "2026-07-01T00:00:00Z", end: "2026-07-07T23:59:59Z" },
    });
  });

  it("renders empty relationship agenda results as an empty agenda view", () => {
    const view = toAssistantToolView({
      toolName: "get_relationship_agenda",
      output: { candidates: [], component: { type: "relationship_agenda", resultCount: 0 } },
    });

    expect(view).toEqual({ kind: "relationship_agenda", candidates: [], window: null });
  });

  it("renders a create_message_draft result as a persisted draft view", () => {
    const view = toAssistantToolView({
      toolName: "create_message_draft",
      output: {
        created: true,
        component: { type: "message_draft", draftId: "draft-1" },
        draft: {
          id: "draft-1",
          personId: "person-1",
          channel: "text",
          purpose: "check_in",
          status: "draft",
          body: "Hi Mark — how's Denver?",
        },
        grounding: [{ trust: "confirmed_fact", label: "Moved to Denver" }],
      },
    });

    expect(view).toEqual({
      kind: "message_draft",
      draftId: "draft-1",
      personId: "person-1",
      status: "draft",
      body: "Hi Mark — how's Denver?",
      grounding: [{ trust: "confirmed_fact", label: "Moved to Denver" }],
    });
  });

  it("renders a declined create_message_draft as an honest neutral line, not an error", () => {
    const view = toAssistantToolView({
      toolName: "create_message_draft",
      output: { created: false, reason: "insufficient_context" },
    });

    // `created: false` is an honest negative outcome — no draft was made — so it reads
    // as a calm neutral note, never the malformed/possibly-failed treatment.
    expect(view).toEqual({
      kind: "generic",
      toolName: "create_message_draft",
      note: "No draft was created",
    });
  });

  it("renders propose_message_draft as an ephemeral grounded Draft Proposal", () => {
    const view = toAssistantToolView({
      toolName: "propose_message_draft",
      output: {
        ownerUserId: "owner-1",
        proposal: {
          id: "draft_proposal:person-1:warm",
          ownerUserId: "owner-1",
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
        component: { type: "draft_proposal", proposalId: "draft_proposal:person-1:warm" },
      },
    });

    expect(view).toEqual({
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
  });

  it("renders skipped propose_message_draft results as a typed empty proposal", () => {
    const view = toAssistantToolView({
      toolName: "propose_message_draft",
      output: {
        ownerUserId: "owner-1",
        proposal: null,
        skippedReason: "insufficient_context",
        component: { type: "draft_proposal", proposalId: null },
      },
    });

    expect(view).toEqual({
      kind: "draft_proposal",
      proposal: null,
      skippedReason: "insufficient_context",
    });
  });

  // Shared ref factory mirroring the agent's toGeneralActionRef output.
  function gaRef(overrides: Record<string, unknown> = {}) {
    return {
      id: "ga-1",
      title: "Replace the fridge water filter",
      status: "open",
      dueAt: null,
      deferUntil: null,
      isRoutine: false,
      recurrence: null,
      areaId: null,
      people: [] as { id: string; displayName: string }[],
      visibilityChoice: "only_me",
      visibilityLabel: "Only me",
      ...overrides,
    };
  }

  it("renders a create_general_action result as a created-action view without ids", () => {
    const view = toAssistantToolView({
      toolName: "create_general_action",
      output: {
        action: gaRef({ people: [{ id: "person-1", displayName: "Priya Shah" }] }),
        component: { type: "general_action_created", generalActionId: "ga-1" },
      },
    });

    expect(view).toEqual({
      kind: "created_general_action",
      generalActionId: "ga-1",
      title: "Replace the fridge water filter",
      status: "open",
      isRoutine: false,
      recurrenceLabel: null,
      timingLabel: null,
      personNames: ["Priya Shah"],
      visibilityLabel: "Only me",
    });
  });

  it("resolves a created Routine's cadence and a dated action's timing label", () => {
    const routine = toAssistantToolView({
      toolName: "create_general_action",
      output: { action: gaRef({ isRoutine: true, recurrence: "Every 6 months" }) },
    });
    expect(routine).toMatchObject({ isRoutine: true, recurrenceLabel: "Every 6 months" });

    const dated = toAssistantToolView({
      toolName: "create_general_action",
      output: { action: gaRef({ dueAt: "2026-07-15T00:00:00.000Z" }) },
    });
    expect(dated).toMatchObject({ timingLabel: dueLabel });
  });

  it("renders a scheduled reminder label and keeps a failed schedule visibly partial", () => {
    const scheduled = toAssistantToolView({
      toolName: "create_general_action",
      output: {
        action: gaRef({ dueAt: "2026-08-16T00:00:00.000Z" }),
        reminder: {
          status: "scheduled",
          label: "Reminder at 15:00 · America/Chicago",
          timeZone: "America/Chicago",
          intendedAt: "2026-08-16T20:00:00.000Z",
          optInOffered: false,
        },
      },
    });
    expect(scheduled).toMatchObject({
      reminderStatus: "scheduled",
      reminderLabel: "Reminder at 15:00 · America/Chicago",
    });

    const failed = toAssistantToolView({
      toolName: "create_general_action",
      output: {
        action: gaRef({ dueAt: "2026-08-16T00:00:00.000Z" }),
        reminder: { status: "failed", reason: "unavailable" },
      },
    });
    expect(failed).toMatchObject({
      reminderStatus: "failed",
      reminderLabel: "Action saved; reminder not scheduled",
    });
  });

  it("renders suggest_general_action and get_suggested_general_action_review as review items", () => {
    const output = {
      found: true,
      component: { type: "suggested_general_action_review", generalActionId: "ga-1" },
      action: gaRef({ status: "suggested", dueAt: "2026-07-15T00:00:00.000Z" }),
      sourceRecord: { id: "source-1" },
    };

    const expected = {
      kind: "suggested_general_action_review",
      generalActionId: "ga-1",
      title: "Replace the fridge water filter",
      status: "suggested",
      timingLabel: dueLabel,
      isRoutine: false,
      recurrenceLabel: null,
      personNames: [],
      visibilityLabel: "Only me",
    };

    expect(toAssistantToolView({ toolName: "suggest_general_action", output })).toEqual(expected);
    expect(
      toAssistantToolView({ toolName: "get_suggested_general_action_review", output }),
    ).toEqual(expected);
  });

  it("renders a resolved (found: false) suggested-action review as an honest neutral line", () => {
    const view = toAssistantToolView({
      toolName: "get_suggested_general_action_review",
      output: { found: false },
    });

    // The proposal is already handled — a well-formed negative, not corruption — so it
    // reads as a calm neutral note, never the malformed alarm.
    expect(view).toEqual({
      kind: "generic",
      toolName: "get_suggested_general_action_review",
      note: "No suggested action to review",
    });
  });

  it("maps a plan and a review list into one review item per proposed action", () => {
    const plan = toAssistantToolView({
      toolName: "plan_suggested_general_actions",
      output: {
        found: true,
        count: 2,
        proposed: [
          { action: gaRef({ id: "ga-1", title: "Book the campsite", status: "suggested" }) },
          { action: gaRef({ id: "ga-2", title: "Rent the gear", status: "suggested" }) },
        ],
      },
    });
    expect(plan).toMatchObject({
      kind: "suggested_general_action_review_list",
      reviews: [
        { generalActionId: "ga-1", title: "Book the campsite" },
        { generalActionId: "ga-2", title: "Rent the gear" },
      ],
    });

    const list = toAssistantToolView({
      toolName: "list_suggested_general_action_reviews",
      output: {
        found: true,
        reviews: [
          {
            action: gaRef({ id: "ga-3", title: "Renew the registration", status: "suggested" }),
            sourceRecord: { id: "s3" },
          },
        ],
      },
    });
    expect(list).toMatchObject({
      kind: "suggested_general_action_review_list",
      reviews: [{ generalActionId: "ga-3", title: "Renew the registration" }],
    });
  });

  it("maps a list_general_actions result into a bounded ledger list without ids", () => {
    const view = toAssistantToolView({
      toolName: "list_general_actions",
      output: {
        found: true,
        ledger: "active",
        window: "this_week",
        count: 1,
        actions: [
          gaRef({
            id: "ga-9",
            title: "Rotate the tires",
            status: "deferred",
            deferUntil: "2026-07-20T00:00:00.000Z",
            people: [{ id: "person-2", displayName: "Sam" }],
          }),
        ],
      },
    });

    const deferLabel = formatSurfacingDay(new Date("2026-07-20T00:00:00.000Z"), new Date());
    expect(view).toEqual({
      kind: "general_action_list",
      ledger: "active",
      window: "this_week",
      actions: [
        {
          generalActionId: "ga-9",
          title: "Rotate the tires",
          status: "deferred",
          isRoutine: false,
          recurrenceLabel: null,
          timingLabel: `Set aside until ${deferLabel}`,
          personNames: ["Sam"],
          visibilityLabel: "Only me",
        },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("person-2");
  });

  it("drops review-status rows so a suggested proposal never poses as a committed ledger action", () => {
    const view = toAssistantToolView({
      toolName: "list_general_actions",
      output: {
        found: true,
        ledger: "active",
        window: null,
        count: 3,
        actions: [
          gaRef({ id: "ga-open", title: "Rotate the tires", status: "open" }),
          gaRef({ id: "ga-suggested", title: "Book the campsite", status: "suggested" }),
          gaRef({ id: "ga-ignored", title: "Old idea", status: "ignored" }),
        ],
      },
    });

    expect(view).toMatchObject({
      kind: "general_action_list",
      actions: [{ generalActionId: "ga-open", title: "Rotate the tires" }],
    });
    // The tentative rows — which carry no accept/dismiss affordance in the read-only
    // disclosure — are gone entirely.
    expect(JSON.stringify(view)).not.toContain("Book the campsite");
    expect(JSON.stringify(view)).not.toContain("Old idea");
  });

  it("degrades an unknown tool to a benign generic view, with no malformed flag", () => {
    const view = toAssistantToolView({ toolName: "some_future_tool", output: { whatever: true } });

    // An unrecognized tool that ran to completion is benign housekeeping, not a failure.
    expect(view).toEqual({ kind: "generic", toolName: "some_future_tool" });
  });

  it("degrades a known tool's malformed payload to a MALFORMED generic, not routine housekeeping", () => {
    const view = toAssistantToolView({ toolName: "capture_memory", output: { memory: null } });

    // A capture_memory whose payload failed its schema is a possibly-failed save; it
    // must read as degraded, distinct from the benign unknown-tool line above.
    expect(view).toEqual({ kind: "generic", toolName: "capture_memory", malformed: true });
  });

  it("keys a view on its persisted record id, not array position", () => {
    expect(
      assistantToolViewKey({
        kind: "saved_memory",
        memoryId: "memory-1",
        sourceRecordId: "source-1",
        personId: "person-1",
        personName: "Caleb",
        content: "x",
      }),
    ).toBe("memory:memory-1");
    expect(assistantToolViewKey({ kind: "generic", toolName: "some_future_tool" })).toBe(
      "tool:some_future_tool",
    );
    expect(
      assistantToolViewKey({
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
            snippet: "x",
            matchedFields: ["displayName"],
            trustLevel: "identity_reference",
            sensitivity: "normal",
          },
        ],
      }),
    ).toBe("search:person-1");
    expect(
      assistantToolViewKey({
        kind: "semantic_context_search",
        results: [
          {
            recordKind: "memory",
            recordId: "memory-1",
            visibilityChoice: "only_me",
            visibilityLabel: "Only me",
            relatedPersonId: "person-1",
            relatedPersonDisplayName: "Mara Lin",
            snippet: "x",
            similarity: 0.8,
            trustLevel: "confirmed_fact",
            sensitivity: "normal",
          },
        ],
      }),
    ).toBe("semantic-search:memory-1");
    expect(
      assistantToolViewKey({
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
            rank: 1,
          },
        ],
      }),
    ).toBe("agenda:followup:followup-1");
    expect(
      assistantToolViewKey({
        kind: "memory_curator_proposals",
        proposals: [
          {
            id: "duplicate_memory:memory-1:memory-2",
            proposalKind: "duplicate_memory",
            personId: "person-1",
            personDisplayName: "Maya",
            title: "Possible duplicate memory for Maya",
            reason: "Two approved memories have the same normalized content.",
            suggestedAction: "Review both memories.",
            sourceRefs: [
              { kind: "memory", id: "memory-1", label: "Maya lives in Austin." },
              { kind: "memory", id: "memory-2", label: "Maya lives in Austin." },
            ],
            sensitivity: "normal",
            reviewOnly: true,
          },
        ],
      }),
    ).toBe("memory-curator:duplicate_memory:memory-1:memory-2");
    expect(
      assistantToolViewKey({
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
              body: "Hi Maya.",
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
      }),
    ).toBe("draft-proposal:draft_proposal:person-1:warm");
    expect(
      relationshipAgendaCandidateKey({
        kind: "recent_context",
        personId: "person-1",
        personDisplayName: "Mara Lin",
        title: "Recent logged context for Mara Lin",
        reason: "Mara shared a recent update.",
        dueAt: "2026-06-25T12:00:00.000Z",
        dueLabel: "Jun 25, 2026",
        sourceRefs: [],
        trustLevel: "logged_context",
        sensitivity: "normal",
        rank: 3,
      }),
    ).toBe("recent_context:3:person-1");
  });
});

/**
 * Asset facts Eve proposed (#196 story 57). The parse has one job the whole feature
 * rests on: hand the chat the *same* `AssetReviewGroupView` the Review tab's card takes,
 * so the proposal is reviewed by the #198 card rather than a chat-only lookalike. If it
 * degraded to `generic`, the user would be told a fact is "waiting for review" with no
 * card to review it on.
 */
describe("toAssistantToolView (asset facts proposed for review)", () => {
  const proposal = {
    found: true,
    groupId: "group-1",
    asset: {
      id: "asset-1",
      name: "Kitchen refrigerator",
      kind: "appliance",
      kindLabel: "Appliance",
      scope: "private",
      visibilityLabel: "Only me",
      pending: false,
    },
    memories: [
      {
        id: "memory-1",
        label: "Filter model",
        value: { type: "text", text: "EDR1RXD1" },
        notes: null,
      },
    ],
    duplicates: [],
    source: {
      id: "source-1",
      content: "The filter in my kitchen fridge is EDR1RXD1",
      sourceType: "agent",
      capturedAt: "2026-07-13T00:00:00.000Z",
    },
    pendingCount: 1,
  };

  it("renders a proposal as the shared Asset Review Group card view", () => {
    const view = toAssistantToolView({ toolName: "propose_asset_memories", output: proposal });

    expect(view.kind).toBe("asset_review_group");
    if (view.kind !== "asset_review_group") throw new Error("expected an asset review group");

    expect(view.review.groupId).toBe("group-1");
    expect(view.review.asset.name).toBe("Kitchen refrigerator");
    // The exact part number, formatted for reading but never altered.
    expect(view.review.memories[0]?.valueLabel).toBe("EDR1RXD1");
    expect(view.review.memories[0]?.value).toEqual({ type: "text", text: "EDR1RXD1" });
    // The user's own words ride along, so the card can show what Eve heard.
    expect(view.review.source?.content).toBe("The filter in my kitchen fridge is EDR1RXD1");
    // A fresh proposal has no evidence and was not promoted from an action hint (#199).
    expect(view.review.evidence).toEqual([]);
    expect(view.review.fromAction).toBeNull();
  });

  it("carries the pending anchor and its duplicate prompt when the asset is new", () => {
    const view = toAssistantToolView({
      toolName: "propose_asset_memories",
      output: {
        ...proposal,
        asset: { ...proposal.asset, pending: true },
        duplicates: [{ id: "asset-2", name: "Refrigerator", kindLabel: "Appliance" }],
        pendingCount: 2,
      },
    });

    if (view.kind !== "asset_review_group") throw new Error("expected an asset review group");
    expect(view.review.asset.pending).toBe(true);
    // The #198 link-to-existing prompt: the user is asked, not silently duplicated.
    expect(view.review.duplicates[0]?.name).toBe("Refrigerator");
    expect(view.review.pendingCount).toBe(2);
  });

  it("keys the view on the persisted review group", () => {
    const view = toAssistantToolView({ toolName: "propose_asset_memories", output: proposal });
    expect(assistantToolViewKey(view)).toBe("asset-review-group:group-1");
  });

  it("degrades to generic rather than inventing a proposal from a malformed payload", () => {
    const view = toAssistantToolView({
      toolName: "propose_asset_memories",
      output: { found: true, groupId: "group-1" },
    });
    expect(view.kind).toBe("generic");
  });
});

/**
 * Unified Asset Search and snapshot-backed Asset context (#204). These cross the same
 * interface production does — `toAssistantToolView` → view — and cover the paths the
 * epic calls out: a grounded search, an empty search, a fresh context, the
 * stale-snapshot rule (a `fallback` summary is dropped), and a not-found context.
 */
describe("toAssistantToolView (asset search and context)", () => {
  it("renders search_assets as grounded records, preserving exact values and trust", () => {
    const view = toAssistantToolView({
      toolName: "search_assets",
      output: {
        query: "fridge filter",
        results: [
          {
            recordKind: "asset_memory",
            recordId: "memory-1",
            assetId: "asset-1",
            assetName: "Kitchen refrigerator",
            assetKind: "appliance",
            label: "Filter model",
            snippet: "The filter is EDR1RXD1.",
            value: "EDR1RXD1",
            matchKinds: ["structured", "exact"],
            trustLevel: "asset_fact",
            visibilityChoice: "only_me",
            visibilityLabel: "Only me",
          },
        ],
      },
    });

    expect(view).toEqual({
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
          // The exact stored value survives verbatim — Eve writes prose from it, not over it.
          value: "EDR1RXD1",
          matchKinds: ["structured", "exact"],
          trustLevel: "asset_fact",
          visibilityLabel: "Only me",
          // Absent from the tool output above, and defaulted rather than dropped: a
          // result persisted before the field existed reads as the conservative
          // form, so the card keeps naming the audience someone did choose.
          ownership: "member_owned",
        },
      ],
    });
    // A non-empty search collapses behind a disclosure; an empty one recedes to a line.
    expect(toolViewTier(view)).toBe("disclosure");
  });

  it("renders an empty search_assets result as a quiet line", () => {
    const view = toAssistantToolView({
      toolName: "search_assets",
      output: { query: "nothing", results: [] },
    });

    expect(view).toEqual({ kind: "asset_search", query: "nothing", results: [] });
    expect(toolViewTier(view)).toBe("line");
  });

  it("renders a fresh get_asset_context as a found card, facts and summary intact", () => {
    const view = toAssistantToolView({
      toolName: "get_asset_context",
      output: {
        assetId: "asset-1",
        assetName: "Kitchen refrigerator",
        assetKind: "appliance",
        assetStatus: "active",
        visibilityLabel: "Only me",
        snapshotStatus: "fresh",
        summary: "A kitchen fridge; the filter is EDR1RXD1.",
        facts: [
          {
            memoryId: "m1",
            label: "Filter model",
            value: "EDR1RXD1",
            notes: null,
            visibilityLabel: "Only me",
          },
        ],
        evidence: [{ evidenceId: "e1", kind: "photo", label: "Filter photo" }],
        relatedAssets: [{ assetId: "asset-2", relation: "pairs_with", name: "Water line" }],
        actions: [{ actionId: "a1", title: "Replace filter", status: "open", dueAt: null }],
      },
    });

    expect(view).toEqual({
      kind: "asset_context",
      found: true,
      assetName: "Kitchen refrigerator",
      snapshotStatus: "fresh",
      summary: "A kitchen fridge; the filter is EDR1RXD1.",
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
      evidence: [{ evidenceId: "e1", kind: "photo", label: "Filter photo" }],
      actions: [{ actionId: "a1", title: "Replace filter", status: "open", dueAt: null }],
    });
    expect(toolViewTier(view)).toBe("card");
  });

  it("drops a fallback snapshot's summary so stale prose is never shown as current", () => {
    const view = toAssistantToolView({
      toolName: "get_asset_context",
      output: {
        assetId: "asset-1",
        assetName: "Kitchen refrigerator",
        assetKind: "appliance",
        assetStatus: "active",
        visibilityLabel: "Only me",
        snapshotStatus: "fallback",
        summary: "Stale cached prose that has outlived its facts.",
        facts: [
          {
            memoryId: "m1",
            label: "Filter model",
            value: "EDR1RXD1",
            notes: null,
            visibilityLabel: "Only me",
          },
        ],
        evidence: [],
        relatedAssets: [],
        actions: [],
      },
    });

    if (view.kind !== "asset_context") throw new Error("expected an asset context view");
    // The reviewed fact stands; the stale summary is dropped rather than shown as truth.
    expect(view.summary).toBeNull();
    expect(view.snapshotStatus).toBe("fallback");
    expect(view.facts[0]?.value).toBe("EDR1RXD1");
    expect(JSON.stringify(view)).not.toContain("Stale cached prose");
  });

  it("renders a not-found (found: false) get_asset_context as a safe empty state", () => {
    const view = toAssistantToolView({
      toolName: "get_asset_context",
      output: { found: false },
    });

    expect(view).toEqual({
      kind: "asset_context",
      found: false,
      assetName: null,
      snapshotStatus: null,
      summary: null,
      facts: [],
      evidence: [],
      actions: [],
    });
    expect(toolViewTier(view)).toBe("line");
  });
});

describe("toolViewTier (how much weight a result earns)", () => {
  it("keeps durable, trust-bearing results as cards", () => {
    expect(
      toolViewTier({
        kind: "saved_memory",
        memoryId: "m1",
        sourceRecordId: null,
        personId: null,
        personName: null,
        content: "x",
      }),
    ).toBe("card");
    expect(
      toolViewTier({
        kind: "added_person",
        personId: "p1",
        displayName: "A",
        relationshipType: null,
      }),
    ).toBe("card");
    expect(
      toolViewTier({
        kind: "suggested_memory_review",
        memoryId: "m1",
        content: "x",
        sourceRecordId: null,
        personId: null,
        personName: null,
      }),
    ).toBe("card");
    expect(
      toolViewTier({
        kind: "created_general_action",
        generalActionId: "ga-1",
        title: "Replace the fridge water filter",
        status: "open",
        isRoutine: false,
        recurrenceLabel: null,
        timingLabel: null,
        personNames: [],
        visibilityLabel: "Only me",
      }),
    ).toBe("card");
    // The interactive review kinds are panel-routed, but keep the durable card weight as
    // their default so a stray one never recedes to an ambient line.
    const reviewItem = {
      generalActionId: "ga-1",
      title: "Book the campsite",
      status: "suggested",
      timingLabel: null,
      isRoutine: false,
      recurrenceLabel: null,
      personNames: [] as string[],
      visibilityLabel: "Only me",
    };
    expect(toolViewTier({ kind: "suggested_general_action_review", ...reviewItem })).toBe("card");
    expect(
      toolViewTier({ kind: "suggested_general_action_review_list", reviews: [reviewItem] }),
    ).toBe("card");
  });

  it("recedes ambient lookups to a quiet line", () => {
    expect(toolViewTier({ kind: "generic", toolName: "search_people" })).toBe("line");
    expect(
      toolViewTier({
        kind: "person_context",
        personId: "p1",
        personName: "Alex",
        snapshotStatus: "fresh",
        approvedCount: 2,
        loggedCount: 1,
        suggestedCount: 0,
      }),
    ).toBe("line");
  });

  it("collapses a non-empty search behind a disclosure but lines an empty one", () => {
    const result = {
      recordKind: "person" as const,
      recordId: "p1",
      visibilityChoice: null,
      visibilityLabel: null,
      relatedPersonId: "p1",
      relatedPersonDisplayName: "Alex",
      label: "Alex",
      snippet: "x",
      matchedFields: ["displayName"],
      trustLevel: "identity_reference" as const,
      sensitivity: "normal" as const,
    };
    expect(toolViewTier({ kind: "relationship_context_search", results: [result] })).toBe(
      "disclosure",
    );
    expect(toolViewTier({ kind: "relationship_context_search", results: [] })).toBe("line");
    expect(
      toolViewTier({
        kind: "semantic_context_search",
        results: [
          {
            recordKind: "memory",
            recordId: "m1",
            visibilityChoice: "only_me",
            visibilityLabel: "Only me",
            relatedPersonId: null,
            relatedPersonDisplayName: null,
            snippet: "x",
            similarity: 0.8,
            trustLevel: "confirmed_fact",
            sensitivity: "normal",
          },
        ],
      }),
    ).toBe("disclosure");
    expect(toolViewTier({ kind: "semantic_context_search", results: [] })).toBe("line");
    expect(
      toolViewTier({
        kind: "relationship_agenda",
        candidates: [
          {
            kind: "birthday",
            personId: "p1",
            personDisplayName: "Alex",
            title: "Alex's birthday",
            reason: "Birthday falls inside the requested window.",
            dueAt: "2026-07-05T00:00:00.000Z",
            dueLabel: "Jul 5, 2026",
            sourceRefs: [{ kind: "person", id: "p1" }],
            trustLevel: "stored_profile_data",
            sensitivity: "normal",
            rank: 1,
          },
        ],
      }),
    ).toBe("disclosure");
    expect(toolViewTier({ kind: "relationship_agenda", candidates: [] })).toBe("line");
    expect(
      toolViewTier({
        kind: "general_action_list",
        ledger: "active",
        window: null,
        actions: [
          {
            generalActionId: "ga-1",
            title: "Rotate the tires",
            status: "open",
            isRoutine: false,
            recurrenceLabel: null,
            timingLabel: null,
            personNames: [],
            visibilityLabel: "Only me",
          },
        ],
      }),
    ).toBe("disclosure");
    expect(
      toolViewTier({ kind: "general_action_list", ledger: "active", window: null, actions: [] }),
    ).toBe("line");
    expect(
      toolViewTier({
        kind: "memory_curator_proposals",
        proposals: [
          {
            id: "rewrite_suggestion:memory-1",
            proposalKind: "rewrite_suggestion",
            personId: "person-1",
            personDisplayName: "Maya",
            title: "Vague memory for Maya",
            reason: "The memory uses vague language.",
            suggestedAction: "Rewrite after owner review.",
            sourceRefs: [{ kind: "memory", id: "memory-1", label: "Maya likes some stuff." }],
            sensitivity: "normal",
            reviewOnly: true,
          },
        ],
      }),
    ).toBe("card");
    expect(toolViewTier({ kind: "memory_curator_proposals", proposals: [] })).toBe("line");
    expect(
      toolViewTier({
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
              body: "Hi Maya.",
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
      }),
    ).toBe("card");
    expect(
      toolViewTier({
        kind: "draft_proposal",
        proposal: null,
        skippedReason: "insufficient_context",
      }),
    ).toBe("line");
  });
});

describe("activeToolLabel (in-flight tool → working copy)", () => {
  it("maps known tools to present-continuous labels", () => {
    expect(activeToolLabel("web_search")).toBe("Searching the web…");
    expect(activeToolLabel("web_fetch")).toBe("Looking that up on the web…");
    expect(activeToolLabel("search_relationship_context")).toBe("Searching your notebook…");
    expect(activeToolLabel("search_semantic_context")).toBe("Searching by meaning…");
    expect(activeToolLabel("get_relationship_agenda")).toBe("Checking your relationship agenda…");
    expect(activeToolLabel("propose_memory_cleanup")).toBe("Reviewing memory cleanup candidates…");
    expect(activeToolLabel("propose_message_draft")).toBe("Drafting options…");
    expect(activeToolLabel("capture_memory")).toBe("Saving to memory…");
  });

  it("humanizes unknown tools with a trailing ellipsis", () => {
    expect(activeToolLabel("some_future_tool")).toBe("some future tool…");
  });

  /**
   * Eve's own built-ins are namespaced, and `eve:load-skill` reached the
   * transcript as "Eve:load-skill" - the framework naming itself to a reader,
   * which is the one thing the product never does. The label is the fix; the
   * namespace-stripping fallback is the floor under whatever eve adds next.
   */
  it("never lets the framework name itself, labelled or not", () => {
    expect(activeToolLabel("eve:load-skill")).toBe("Getting up to speed…");
    expect(completedToolLabel("eve:load-skill")).toBe("Got up to speed");
    expect(activeToolLabel("eve:some-future-builtin")).toBe("some future builtin…");
    expect(completedToolLabel("eve:some-future-builtin")).toBe("Some future builtin");
  });

  it("has an explicit working label for every rendered tool in the shared contract", () => {
    // Every tool that persists a renderable result (the @tendnote/domain registry)
    // must have a hand-written shimmer label, so the label map can't silently drift
    // behind the contract and fall back to the slugified tool name. This half also
    // covers the two subagent tools that reach the chat, which have no file in the
    // root tool directory the next test walks.
    for (const toolName of RENDERED_TOOL_NAMES) {
      const fallback = `${toolName.replace(/_/g, " ")}…`;
      expect(activeToolLabel(toolName)).not.toBe(fallback);
    }
  });

  it("has an explicit working label for every tool Eve can call, card or not", () => {
    // Derived from the tool directory rather than from a list kept here.
    //
    // A shimmer label is a property of the *call*, so the set it has to cover is
    // every tool Eve can call - and most of them render no card at all, which is why
    // RENDERED_TOOL_NAMES above cannot be the whole check. The hand-written array
    // that used to fill the gap only ever caught a tool someone remembered to add to
    // it; the prose mutation tools it named were added long after the tools shipped.
    // `agent/tools/*.ts` is the authoring surface itself, so a tool that lands there
    // without a label fails here on the same commit that adds it. The exclusions are
    // the two file kinds that author no callable tool: the `disableTool()` sentinels
    // that switch a framework tool off, and the dynamic mode gate.
    const toolsDir = join(process.cwd(), "../agent/agent/tools");
    const authoredTools = readdirSync(toolsDir)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => {
        const source = readFileSync(join(toolsDir, file), "utf8");
        return !/export default disableTool\(\)/.test(source) && !/defineDynamic/.test(source);
      })
      .map((file) => file.replace(/\.ts$/, ""));

    expect(authoredTools.length).toBeGreaterThan(RENDERED_TOOL_NAMES.length);
    for (const toolName of authoredTools) {
      const fallback = `${toolName.replace(/_/g, " ")}…`;
      expect(activeToolLabel(toolName), `${toolName} needs a hand-written label`).not.toBe(
        fallback,
      );
    }
  });
});
