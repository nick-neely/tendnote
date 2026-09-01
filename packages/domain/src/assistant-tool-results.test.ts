import { describe, expect, it } from "vitest";
import {
  assistantToolResultSchemas,
  isRenderedToolName,
  RENDERED_TOOL_NAMES,
  relationshipContextSearchToolResult,
  semanticContextSearchToolResult,
} from "./assistant-tool-results";
import { exactRecallRecordKindSchema, exactRecallTrustLevelSchema } from "./exact-recall";
import {
  relationshipSemanticRecordKindSchema,
  relationshipSemanticTrustLevelSchema,
} from "./semantic-retrieval";

describe("assistant tool-result contract", () => {
  it("registers a schema for every rendered tool name", () => {
    expect(RENDERED_TOOL_NAMES.length).toBeGreaterThan(0);
    for (const toolName of RENDERED_TOOL_NAMES) {
      expect(assistantToolResultSchemas[toolName]).toBeDefined();
      expect(isRenderedToolName(toolName)).toBe(true);
    }
  });

  it("does not treat an active-only or unknown tool as rendered", () => {
    // search_people shows a shimmer but persists no rendered result.
    expect(isRenderedToolName("search_people")).toBe(false);
    expect(isRenderedToolName("not_a_tool")).toBe(false);
  });

  it("accepts a well-formed capture_source_record result and rejects a malformed one", () => {
    const schema = assistantToolResultSchemas.capture_source_record;
    expect(
      schema.safeParse({ sourceRecord: { id: "s1", content: "Coffee with Maya" } }).success,
    ).toBe(true);
    // Missing the required content field is a contract violation (renders generic).
    expect(schema.safeParse({ sourceRecord: { id: "s1" } }).success).toBe(false);
  });

  it("strips unknown keys so only the minimized contract crosses the seam", () => {
    const schema = assistantToolResultSchemas.search_semantic_context;
    const parsed = schema.safeParse({
      results: [
        {
          recordKind: "source_record",
          recordId: "sr1",
          visibilityChoice: "selected_members",
          visibilityLabel: "Specific people",
          snippet: "A possible career change.",
          similarity: 0.9,
          trustLevel: "logged_context",
          sensitivity: "sensitive",
          generatedAnswer: "Do not render this.",
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(JSON.stringify(parsed.data)).not.toContain("generatedAnswer");
  });

  it("carries an Asset Search row's ownership form, defaulting an older persisted result", () => {
    // The chat card decides whether to state an audience from this field, so a
    // result that lost it on the way across the seam would put "Whole household"
    // back on the household's own record (ADR 0214).
    const row = {
      recordKind: "asset",
      recordId: "a1",
      assetId: "a1",
      assetName: "Refrigerator",
      assetKind: "appliance",
      label: "Refrigerator",
      snippet: "Refrigerator",
      value: null,
      matchKinds: ["exact"],
      trustLevel: "asset_anchor",
      visibilityChoice: "whole_household",
      visibilityLabel: "Whole household",
    };
    const schema = assistantToolResultSchemas.search_assets;

    const household = schema.safeParse({
      query: "fridge",
      results: [{ ...row, ownership: "household_native" }],
    });
    expect(household.success && household.data.results[0]?.ownership).toBe("household_native");

    // A result written before the field existed still parses, and reads as the
    // conservative form: a record nobody has said is the household's is a member's.
    const older = schema.safeParse({ query: "fridge", results: [row] });
    expect(older.success && older.data.results[0]?.ownership).toBe("member_owned");
  });

  it("carries an Asset context result's ownership form on the asset and on each fact", () => {
    const parsed = assistantToolResultSchemas.get_asset_context.safeParse({
      assetId: "a1",
      assetName: "Refrigerator",
      assetKind: "appliance",
      assetStatus: "active",
      visibilityLabel: "Whole household",
      ownership: "household_native",
      snapshotStatus: "fresh",
      summary: null,
      facts: [
        {
          memoryId: "m1",
          label: "Filter size",
          value: "RPWFE",
          notes: null,
          visibilityLabel: "Whole household",
          ownership: "household_native",
        },
        // The older shape, without the field.
        {
          memoryId: "m2",
          label: "Model",
          value: "GNE27",
          notes: null,
          visibilityLabel: "Only me",
        },
      ],
      evidence: [],
      relatedAssets: [],
      actions: [],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.ownership).toBe("household_native");
    expect(parsed.success && parsed.data.facts.map((fact) => fact.ownership)).toEqual([
      "household_native",
      "member_owned",
    ]);
  });

  it("accepts a relationship-agenda result with candidates and an optional window", () => {
    const parsed = assistantToolResultSchemas.get_relationship_agenda.safeParse({
      candidates: [
        {
          kind: "due_followup",
          title: "Check in with Maya",
          reason: "Reminder due",
          sourceRefs: [{ kind: "followup", id: "f1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          visibilityChoice: "selected_members",
          visibilityLabel: "Specific people",
          rank: 1,
        },
      ],
      window: { start: "2026-06-30", end: "2026-07-07" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts review-only Memory Curator proposals with source grounding", () => {
    const parsed = assistantToolResultSchemas.propose_memory_cleanup.safeParse({
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
          suggestedAction: "Review both memories and decide whether one should be archived.",
          sourceRefs: [
            { kind: "memory", id: "memory-1", label: "Maya lives in Austin." },
            { kind: "memory", id: "memory-2", label: "Maya lives in Austin." },
          ],
          sensitivity: "normal",
          reviewOnly: true,
        },
      ],
      component: { type: "memory_curator_proposals", proposalCount: 1 },
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts a created General Action ref and strips the tool's extra keys", () => {
    const parsed = assistantToolResultSchemas.create_general_action.safeParse({
      action: {
        id: "ga-1",
        title: "Replace the fridge water filter",
        status: "open",
        dueAt: null,
        deferUntil: null,
        isRoutine: false,
        recurrence: null,
        areaId: null,
        people: [{ id: "person-1", displayName: "Priya Shah" }],
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        // The tool attaches a component the model view carries; it must not cross the seam.
        component: { type: "general_action_created", generalActionId: "ga-1" },
      },
    });

    expect(parsed.success).toBe(true);
    expect(JSON.stringify(parsed.data)).not.toContain("general_action_created");
  });

  it("keeps explicit reminder success and partial failure typed on a created Action", () => {
    const base = {
      id: "ga-1",
      title: "Replace the fridge water filter",
      status: "open",
      dueAt: "2026-08-16T00:00:00.000Z",
      deferUntil: null,
      isRoutine: false,
      recurrence: null,
      areaId: null,
      people: [],
      visibilityChoice: "only_me" as const,
      visibilityLabel: "Only me",
    };
    const scheduled = assistantToolResultSchemas.create_general_action.safeParse({
      action: base,
      reminder: {
        status: "scheduled",
        label: "Reminder at 15:00 · America/Chicago",
        timeZone: "America/Chicago",
        intendedAt: "2026-08-16T20:00:00.000Z",
        optInOffered: false,
        scheduleId: "must be stripped",
      },
    });
    expect(scheduled.success).toBe(true);
    expect(scheduled.success && scheduled.data.reminder).toMatchObject({ status: "scheduled" });
    expect(JSON.stringify(scheduled.data)).not.toContain("scheduleId");

    const failed = assistantToolResultSchemas.create_general_action.safeParse({
      action: base,
      reminder: { status: "failed", reason: "unavailable", error: "database details" },
    });
    expect(failed.success).toBe(true);
    expect(failed.success && failed.data.reminder).toEqual({
      status: "failed",
      reason: "unavailable",
    });
  });

  it("accepts a suggested General Action review, ignoring the persisted component", () => {
    const parsed = assistantToolResultSchemas.suggest_general_action.safeParse({
      found: true,
      component: { type: "suggested_general_action_review", generalActionId: "ga-2" },
      action: {
        id: "ga-2",
        title: "Book the campsite for the trip",
        status: "suggested",
        dueAt: "2026-07-15T00:00:00.000Z",
        deferUntil: null,
        isRoutine: false,
        recurrence: null,
        areaId: null,
        people: [],
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
      },
      sourceRecord: { id: "source-1" },
    });

    expect(parsed.success).toBe(true);
    expect(JSON.stringify(parsed.data)).not.toContain("suggested_general_action_review");
  });

  it("rejects a suggested General Action review that lost its action", () => {
    // A `found: false` review (the proposal is gone) has no action — it must fail the
    // contract so the web degrades to a quiet line rather than inventing a card.
    expect(
      assistantToolResultSchemas.suggest_general_action.safeParse({ found: false }).success,
    ).toBe(false);
  });

  it("accepts a shallow plan of proposed General Actions", () => {
    const parsed = assistantToolResultSchemas.plan_suggested_general_actions.safeParse({
      found: true,
      count: 2,
      proposed: [
        {
          component: { type: "suggested_general_action_review", generalActionId: "ga-3" },
          action: {
            id: "ga-3",
            title: "Book the campsite",
            status: "suggested",
            dueAt: null,
            deferUntil: null,
            isRoutine: false,
            recurrence: null,
            areaId: null,
            people: [],
            visibilityChoice: "only_me",
            visibilityLabel: "Only me",
          },
        },
        {
          action: {
            id: "ga-4",
            title: "Rent the gear",
            status: "suggested",
            dueAt: null,
            deferUntil: null,
            isRoutine: false,
            recurrence: null,
            areaId: null,
            people: [],
            visibilityChoice: "only_me",
            visibilityLabel: "Only me",
          },
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts a bounded General Action ledger list", () => {
    const parsed = assistantToolResultSchemas.list_general_actions.safeParse({
      found: true,
      ledger: "active",
      window: "this_week",
      count: 1,
      actions: [
        {
          id: "ga-5",
          title: "Rotate the tires",
          status: "deferred",
          dueAt: "2026-07-01T00:00:00.000Z",
          deferUntil: "2026-07-20T00:00:00.000Z",
          isRoutine: true,
          recurrence: "Every 6 months",
          areaId: "area-1",
          people: [],
          visibilityChoice: "whole_household",
          visibilityLabel: "Whole household",
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts ephemeral Draft Proposals with variants and source grounding", () => {
    const parsed = assistantToolResultSchemas.propose_message_draft.safeParse({
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
    });

    expect(parsed.success).toBe(true);
  });

  /**
   * The card contract used to be a hand-written subset of the search contract that
   * predated General Actions. So the moment either search matched an Action, the row
   * failed the card schema, the web's parser returned null, and the *whole* result
   * set collapsed to "didn't return a readable result" — one unrenderable row cost
   * the user every row beside it (ADR 0150).
   *
   * These assert the structural fix rather than the symptom: the card accepts every
   * value its producing contract can emit, so it can never again be the narrower of
   * the two.
   */
  describe("the recall cards accept everything their search contract can return", () => {
    function exactRow(recordKind: string, trustLevel: string) {
      return {
        recordKind,
        recordId: "record-1",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        relatedPersonId: null,
        relatedPersonDisplayName: null,
        label: "Replace the fridge water filter",
        snippet: "Replace the fridge water filter",
        matchedFields: ["title"],
        trustLevel,
        sensitivity: "normal",
      };
    }

    function semanticRow(recordKind: string, trustLevel: string) {
      return {
        recordKind,
        recordId: "record-1",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        snippet: "Replace the fridge water filter",
        similarity: 0.82,
        trustLevel,
        sensitivity: "normal",
      };
    }

    it.each(exactRecallRecordKindSchema.options)("accepts an exact %s result", (recordKind) => {
      const parsed = relationshipContextSearchToolResult.safeParse({
        results: [exactRow(recordKind, "confirmed_fact")],
      });
      expect(parsed.success).toBe(true);
    });

    it.each(exactRecallTrustLevelSchema.options)("accepts the exact %s register", (trustLevel) => {
      const parsed = relationshipContextSearchToolResult.safeParse({
        results: [exactRow("general_action", trustLevel)],
      });
      expect(parsed.success).toBe(true);
    });

    it.each(relationshipSemanticRecordKindSchema.options)(
      "accepts a semantic %s result",
      (recordKind) => {
        const parsed = semanticContextSearchToolResult.safeParse({
          results: [semanticRow(recordKind, "confirmed_fact")],
        });
        expect(parsed.success).toBe(true);
      },
    );

    it.each(relationshipSemanticTrustLevelSchema.options)(
      "accepts the semantic %s register",
      (trustLevel) => {
        const parsed = semanticContextSearchToolResult.safeParse({
          results: [semanticRow("general_action", trustLevel)],
        });
        expect(parsed.success).toBe(true);
      },
    );

    it("keeps one General Action from costing the rest of the result set", () => {
      const parsed = relationshipContextSearchToolResult.safeParse({
        results: [
          exactRow("memory", "confirmed_fact"),
          exactRow("general_action", "action_item"),
          exactRow("person", "identity_reference"),
        ],
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.results).toHaveLength(3);
    });
  });

  it("renders Global Recall as its own card rather than a generic line", () => {
    // `search_global_recall` emitted `component: { type: "global_recall" }` with no
    // schema behind it, so Eve's one cross-domain answer arrived unnamed (ADR 0199).
    expect(isRenderedToolName("search_global_recall")).toBe(true);

    const parsed = assistantToolResultSchemas.search_global_recall.safeParse({
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
      ],
      limitations: [{ source: "calendar", message: "Calendar results are unavailable." }],
      hasMore: true,
    });

    expect(parsed.success).toBe(true);
    // The deep link survives the seam: a row opened from chat lands where the same
    // row opened from the search palette lands.
    expect(parsed.success && parsed.data.results[0]?.href).toBe("/actions#action-ga-1");
    expect(parsed.success && parsed.data.limitations).toHaveLength(1);
    expect(parsed.success && parsed.data.hasMore).toBe(true);
  });
});
