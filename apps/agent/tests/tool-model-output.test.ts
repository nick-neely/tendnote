import { describe, expect, it } from "vitest";
import acceptSuggestedFollowupTool from "../agent/tools/accept_suggested_followup";
import acceptSuggestedGeneralActionTool from "../agent/tools/accept_suggested_general_action";
import approveSuggestedMemoryTool from "../agent/tools/approve_suggested_memory";
import captureMemoryTool from "../agent/tools/capture_memory";
import captureSourceRecordTool from "../agent/tools/capture_source_record";
import createGeneralActionTool from "../agent/tools/create_general_action";
import createMessageDraftTool from "../agent/tools/create_message_draft";
import createPersonTool from "../agent/tools/create_person";
import dismissSuggestedGeneralActionTool from "../agent/tools/dismiss_suggested_general_action";
import dismissSuggestedMemoryTool from "../agent/tools/dismiss_suggested_memory";
import editGeneralActionTool from "../agent/tools/edit_general_action";
import agendaTool from "../agent/tools/get_relationship_agenda";
import getSuggestedFollowupReviewTool from "../agent/tools/get_suggested_followup_review";
import getSuggestedGeneralActionReviewTool from "../agent/tools/get_suggested_general_action_review";
import getSuggestedMemoryReviewTool from "../agent/tools/get_suggested_memory_review";
import listGeneralActionsTool from "../agent/tools/list_general_actions";
import listSuggestedFollowupReviewsTool from "../agent/tools/list_suggested_followup_reviews";
import listSuggestedGeneralActionReviewsTool from "../agent/tools/list_suggested_general_action_reviews";
import listSuggestedMemoryReviewsTool from "../agent/tools/list_suggested_memory_reviews";
import planSuggestedGeneralActionsTool from "../agent/tools/plan_suggested_general_actions";
import proposeAssetActionsTool from "../agent/tools/propose_asset_actions";
import proposeFollowupTool from "../agent/tools/propose_followup";
import exactSearchTool from "../agent/tools/search_relationship_context";
import semanticSearchTool from "../agent/tools/search_semantic_context";
import suggestGeneralActionTool from "../agent/tools/suggest_general_action";
import updateGeneralActionStatusTool from "../agent/tools/update_general_action_status";
import updatePersonTool from "../agent/tools/update_person";

/**
 * `toModelOutput` shapes what the *model* sees; channels (the web chat) still
 * receive the full structured `execute` output for rich rendering. These checks
 * pin that contract: the model view drops the record/person UUIDs the agent is
 * told never to surface, while keeping the names, kinds, reasons, and trust it
 * needs to write a reply.
 */

const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE_ID = "22222222-2222-2222-2222-222222222222";

type ModelOut = { type: string; value: unknown };

/** Calls a tool's (synchronous) toModelOutput with a sample, casting the strict
 *  param/return types away so the sample stays readable in the test. */
function modelOutput(fn: ((output: never) => unknown) | undefined, output: unknown): ModelOut {
  if (!fn) throw new Error("tool has no toModelOutput");
  return (fn as (o: unknown) => ModelOut)(output);
}

describe("get_relationship_agenda toModelOutput", () => {
  const rawOutput = {
    candidates: [
      {
        kind: "review_item" as const,
        personId: PERSON_ID,
        personDisplayName: "Priya Shah",
        title: "Review suggested memory for Priya Shah",
        reason: "Priya may need a revised launch checklist by Monday.",
        dueAt: undefined,
        sourceRefs: [{ kind: "source_record" as const, id: SOURCE_ID }],
        trustLevel: "tentative" as const,
        sensitivity: "normal" as const,
        visibilityChoice: "whole_household" as const,
        visibilityLabel: "Whole household",
        rank: 1,
      },
    ],
    window: { start: "2026-06-27", end: "2026-06-30" },
    component: { type: "relationship_agenda", resultCount: 1 },
  };

  it("keeps name, kind, reason, and trust but strips ids, sourceRefs, and rank", () => {
    const model = modelOutput(agendaTool.toModelOutput, rawOutput);
    expect(model.type).toBe("json");
    const serialized = JSON.stringify(model.value);

    expect(serialized).toContain("Priya Shah");
    expect(serialized).toContain("review_item");
    expect(serialized).toContain("revised launch checklist");
    expect(serialized).toContain("tentative");
    expect(serialized).toContain("Whole household");
    expect(serialized).toContain("whole_household");

    // Ids and render scaffolding never reach the model.
    expect(serialized).not.toContain(PERSON_ID);
    expect(serialized).not.toContain(SOURCE_ID);
    expect(serialized).not.toContain("sourceRefs");
    expect(serialized).not.toContain("rank");
  });

  it("does not mutate the raw output the channel renders", () => {
    agendaTool.toModelOutput?.(rawOutput);
    // The full payload (ids, sourceRefs, component) is intact for the UI parser.
    expect(rawOutput.candidates[0]?.personId).toBe(PERSON_ID);
    expect(rawOutput.candidates[0]?.sourceRefs[0]?.id).toBe(SOURCE_ID);
    expect(rawOutput.component.type).toBe("relationship_agenda");
  });
});

describe("search tools toModelOutput strip record ids", () => {
  it("exact recall drops record/person ids from the model view", () => {
    const model = modelOutput(exactSearchTool.toModelOutput, {
      results: [
        {
          recordKind: "memory",
          recordId: SOURCE_ID,
          relatedPersonId: PERSON_ID,
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Prefers backend architecture conversations.",
          matchedFields: ["content"],
          trustLevel: "confirmed_fact",
          sensitivity: "normal",
        },
      ],
      component: { type: "relationship_context_search", resultCount: 1 },
    });
    const serialized = JSON.stringify(model.value);
    expect(serialized).toContain("Mara Lin");
    expect(serialized).toContain("backend architecture");
    expect(serialized).not.toContain(SOURCE_ID);
    expect(serialized).not.toContain(PERSON_ID);
    expect(serialized).not.toContain("matchedFields");
  });

  it("semantic recall drops record/person ids from the model view", () => {
    const model = modelOutput(semanticSearchTool.toModelOutput, {
      results: [
        {
          recordKind: "source_record",
          recordId: SOURCE_ID,
          relatedPersonId: PERSON_ID,
          relatedPersonDisplayName: "Mara Lin",
          snippet: "Mentioned a possible career change.",
          similarity: 0.88,
          trustLevel: "logged_context",
          sensitivity: "sensitive",
        },
      ],
      component: { type: "semantic_context_search", resultCount: 1 },
    });
    const serialized = JSON.stringify(model.value);
    expect(serialized).toContain("Mara Lin");
    expect(serialized).toContain("career change");
    expect(serialized).not.toContain(SOURCE_ID);
    expect(serialized).not.toContain(PERSON_ID);
  });
});

/**
 * Card-rendering tools (PRD #75 follow-up): the chat already shows the drafted
 * message, saved note/memory, and suggestion review cards. These project the
 * model's view down so it can't reprint the content the user already sees, while
 * keeping the names/ids/status it needs to frame a brief reply and act on the item
 * when the user asks (approve, dismiss, change) instead of clicking the card. The
 * channel still receives the full `execute` output for rendering.
 */
describe("card tools toModelOutput strip rendered content", () => {
  const MEM_ID = "33333333-3333-3333-3333-333333333333";
  const FUP_ID = "44444444-4444-4444-4444-444444444444";
  const DRAFT_ID = "55555555-5555-5555-5555-555555555555";

  const cases: {
    name: string;
    tool: { toModelOutput?: (output: never) => unknown };
    output: unknown;
    omit: string[];
    include: string[];
  }[] = [
    {
      name: "create_message_draft hides the body and grounding",
      tool: createMessageDraftTool,
      output: {
        created: true,
        component: { type: "message_draft", draftId: DRAFT_ID },
        draft: {
          id: DRAFT_ID,
          personId: PERSON_ID,
          channel: "text",
          purpose: "check_in",
          status: "draft",
          body: "SECRET_DRAFT_BODY",
        },
        grounding: [{ trust: "confirmed_fact", label: "SECRET_GROUNDING" }],
        guidance: "…",
      },
      omit: ["SECRET_DRAFT_BODY", "SECRET_GROUNDING"],
      include: ["draft"],
    },
    {
      name: "capture_memory hides the memory text, keeps the person",
      tool: captureMemoryTool,
      output: {
        memory: {
          id: MEM_ID,
          personId: PERSON_ID,
          content: "SECRET_MEMORY",
          status: "approved",
          sensitivity: "normal",
          confidence: "high",
          sourceRecordId: SOURCE_ID,
        },
        sourceRecord: { id: SOURCE_ID, status: "active" },
        person: { id: PERSON_ID, displayName: "Mara Lin" },
        component: { type: "memory_saved" },
      },
      omit: ["SECRET_MEMORY"],
      include: ["Mara Lin"],
    },
    {
      name: "capture_source_record hides the note text",
      tool: captureSourceRecordTool,
      output: {
        sourceRecord: { id: SOURCE_ID, status: "active", content: "SECRET_NOTE" },
        linkedPersonId: PERSON_ID,
        component: { type: "source_record_saved" },
      },
      omit: ["SECRET_NOTE"],
      include: ["saved"],
    },
    {
      name: "create_person keeps the name to confirm with",
      tool: createPersonTool,
      output: {
        person: { id: PERSON_ID, displayName: "Theo Park", relationshipType: "colleague" },
        component: { type: "person_created", personId: PERSON_ID },
      },
      omit: [],
      include: ["Theo Park"],
    },
    {
      name: "update_person keeps the changed fields, not the full profile",
      tool: updatePersonTool,
      output: {
        updated: true,
        person: { id: PERSON_ID, displayName: "Sam", relationshipType: null },
        updatedFields: ["birthday"],
        component: { type: "person_updated", personId: PERSON_ID },
      },
      omit: [],
      include: ["Sam", "birthday"],
    },
    {
      name: "get_suggested_memory_review hides the suggestion and source text",
      tool: getSuggestedMemoryReviewTool,
      output: {
        found: true,
        component: { type: "suggested_memory_review" },
        person: { id: PERSON_ID, displayName: "Priya Shah" },
        memory: {
          id: MEM_ID,
          personId: PERSON_ID,
          content: "SECRET_SUGGESTION",
          status: "suggested",
          sensitivity: "normal",
          sourceRecordId: SOURCE_ID,
        },
        sourceRecord: { id: SOURCE_ID, content: "SECRET_SOURCE" },
      },
      omit: ["SECRET_SUGGESTION", "SECRET_SOURCE"],
      include: ["Priya Shah"],
    },
    {
      name: "list_suggested_memory_reviews summarizes without the suggestion text",
      tool: listSuggestedMemoryReviewsTool,
      output: {
        found: true,
        personId: PERSON_ID,
        count: 1,
        reviews: [
          {
            component: { type: "suggested_memory_review" },
            person: { id: PERSON_ID, displayName: "Priya Shah" },
            memory: {
              id: MEM_ID,
              content: "SECRET_SUGGESTION",
              sensitivity: "normal",
              sourceRecordId: SOURCE_ID,
            },
          },
        ],
      },
      omit: ["SECRET_SUGGESTION"],
      include: ["Priya Shah"],
    },
    {
      name: "propose_followup hides the reason it just authored",
      tool: proposeFollowupTool,
      output: {
        found: true,
        component: { type: "suggested_followup_review" },
        person: { id: PERSON_ID, displayName: "Jordan" },
        followup: {
          id: FUP_ID,
          personId: PERSON_ID,
          reason: "SECRET_REASON",
          dueAt: "2026-07-01T00:00:00.000Z",
          status: "suggested",
        },
        sourceRecord: { id: SOURCE_ID },
      },
      omit: ["SECRET_REASON"],
      include: ["Jordan"],
    },
    {
      name: "get_suggested_followup_review hides the reason and due date",
      tool: getSuggestedFollowupReviewTool,
      output: {
        found: true,
        component: { type: "suggested_followup_review" },
        person: { id: PERSON_ID, displayName: "Jordan" },
        followup: {
          id: FUP_ID,
          personId: PERSON_ID,
          reason: "SECRET_REASON",
          dueAt: "2026-07-01T00:00:00.000Z",
          status: "suggested",
        },
        sourceRecord: { id: SOURCE_ID },
      },
      omit: ["SECRET_REASON"],
      include: ["Jordan"],
    },
    {
      name: "list_suggested_followup_reviews summarizes without the reasons",
      tool: listSuggestedFollowupReviewsTool,
      output: {
        found: true,
        personId: PERSON_ID,
        count: 1,
        reviews: [
          {
            component: { type: "suggested_followup_review" },
            person: { id: PERSON_ID, displayName: "Jordan" },
            followup: {
              id: FUP_ID,
              personId: PERSON_ID,
              reason: "SECRET_REASON",
              dueAt: "2026-07-01T00:00:00.000Z",
              status: "suggested",
            },
            sourceRecord: { id: SOURCE_ID },
          },
        ],
      },
      omit: ["SECRET_REASON"],
      include: ["Jordan"],
    },
    {
      name: "accept_suggested_followup confirms timing but not the full reason",
      tool: acceptSuggestedFollowupTool,
      output: {
        component: { type: "followup_accepted" },
        person: { id: PERSON_ID, displayName: "Jordan" },
        followup: {
          id: FUP_ID,
          personId: PERSON_ID,
          reason: "SECRET_REASON",
          dueAt: "2026-07-01T00:00:00.000Z",
          status: "open",
        },
      },
      omit: ["SECRET_REASON"],
      include: ["Jordan"],
    },
    {
      name: "approve_suggested_memory hides the memory text on approval",
      tool: approveSuggestedMemoryTool,
      output: {
        component: { type: "memory_approved" },
        memory: {
          id: MEM_ID,
          personId: PERSON_ID,
          content: "SECRET_MEMORY",
          status: "approved",
          sensitivity: "normal",
          sourceRecordId: SOURCE_ID,
          approvedAt: "2026-06-28T00:00:00.000Z",
        },
      },
      omit: ["SECRET_MEMORY"],
      include: ["approved"],
    },
  ];

  for (const { name, tool, output, omit, include } of cases) {
    it(name, () => {
      const model = modelOutput(tool.toModelOutput, output);
      expect(model.type).toBe("json");
      const serialized = JSON.stringify(model.value);
      for (const needle of omit) {
        expect(serialized).not.toContain(needle);
      }
      for (const needle of include) {
        expect(serialized).toContain(needle);
      }
    });
  }
});

/**
 * General Action tools (Phase 5 #185). Unlike the card tools above, the Action *title*
 * is exactly what the model summarizes, so it is KEPT — what must never reach the model
 * is the raw record id (and any linked-person id). These pin the id-stripping per-tool,
 * not just by construction, mirroring the per-tool enumeration precedent above. The
 * channel still receives the full `execute` output (ids included) for rendering.
 */
describe("general action tools toModelOutput keep tool-call ids private from prose", () => {
  const GA_ID = "66666666-6666-4666-8666-666666666666";
  const GA_PERSON_ID = "77777777-7777-4777-8777-777777777777";
  const GA_SOURCE_ID = "88888888-8888-4888-8888-888888888888";
  const ASSET_ID = "99999999-9999-4999-8999-999999999999";

  /** The compact ref shape the General Action tools return (matches toGeneralActionRef). */
  function gaRef(status = "open") {
    return {
      id: GA_ID,
      title: "Replace the fridge water filter",
      status,
      dueAt: null,
      deferUntil: null,
      isRoutine: false,
      recurrence: null,
      areaId: null,
      people: [{ id: GA_PERSON_ID, displayName: "Priya Shah" }],
      visibilityChoice: "only_me" as const,
      visibilityLabel: "Only me",
    };
  }

  const component = {
    type: "suggested_general_action_review" as const,
    generalActionId: GA_ID,
    sourceRecordId: GA_SOURCE_ID,
  };

  const cases: {
    name: string;
    tool: { toModelOutput?: (output: never) => unknown };
    output: unknown;
  }[] = [
    { name: "create_general_action", tool: createGeneralActionTool, output: { action: gaRef() } },
    {
      name: "update_general_action_status",
      tool: updateGeneralActionStatusTool,
      output: { action: gaRef("completed") },
    },
    { name: "edit_general_action", tool: editGeneralActionTool, output: { action: gaRef() } },
    {
      name: "suggest_general_action",
      tool: suggestGeneralActionTool,
      output: {
        found: true,
        component,
        action: gaRef("suggested"),
        sourceRecord: { id: GA_SOURCE_ID },
      },
    },
    {
      name: "plan_suggested_general_actions",
      tool: planSuggestedGeneralActionsTool,
      output: { found: true, count: 1, proposed: [{ component, action: gaRef("suggested") }] },
    },
    {
      name: "list_general_actions",
      tool: listGeneralActionsTool,
      output: {
        found: true,
        ledger: "active",
        window: null,
        count: 1,
        actions: [gaRef()],
        // The owner's Areas, resolved by `execute` so the projection can name the one an
        // action is filed under instead of dropping an id nobody could explain.
        areaNames: {},
      },
    },
    {
      name: "list_suggested_general_action_reviews",
      tool: listSuggestedGeneralActionReviewsTool,
      output: {
        found: true,
        count: 1,
        reviews: [{ component, action: gaRef("suggested"), sourceRecord: null }],
      },
    },
    {
      name: "get_suggested_general_action_review",
      tool: getSuggestedGeneralActionReviewTool,
      output: { found: true, component, action: gaRef("suggested"), sourceRecord: null },
    },
    {
      name: "accept_suggested_general_action",
      tool: acceptSuggestedGeneralActionTool,
      output: { component, action: gaRef("open") },
    },
    {
      name: "dismiss_suggested_general_action",
      tool: dismissSuggestedGeneralActionTool,
      output: {
        action: { id: GA_ID, title: "Replace the fridge water filter", status: "dismissed" },
      },
    },
    {
      name: "propose_asset_actions",
      tool: proposeAssetActionsTool,
      output: {
        found: true,
        proposed: [{ action: gaRef("suggested") }],
        asset: { id: ASSET_ID, name: "Refrigerator water filter" },
      },
    },
  ];

  for (const { name, tool, output } of cases) {
    it(`${name} exposes the action id for follow-up tool calls but strips person ids`, () => {
      const model = modelOutput(tool.toModelOutput, output);
      expect(model.type).toBe("json");
      const serialized = JSON.stringify(model.value);
      // The model needs the action id to call an id-taking mutation. Linked-person ids
      // remain unnecessary implementation detail and stay out of its context.
      expect(serialized).toContain(GA_ID);
      expect(serialized).not.toContain(GA_PERSON_ID);
      // The title (and person names) are what the model summarizes, so they stay.
      expect(serialized).toContain("Replace the fridge water filter");
    });
  }

  /**
   * `propose_asset_actions` (#203) carries two things the other proposal tools do not:
   * the Asset the pass was about, and an empty result that is a real answer rather than
   * a failure. Both are load-bearing for the review gate — the model must name the thing
   * without leaking its id, and must not invent a reminder when the pass proposed none.
   */
  describe("propose_asset_actions toModelOutput", () => {
    it("names the asset without leaking its id", () => {
      const model = modelOutput(proposeAssetActionsTool.toModelOutput, {
        found: true,
        proposed: [{ action: gaRef("suggested") }],
        asset: { id: ASSET_ID, name: "Refrigerator water filter" },
      });

      const serialized = JSON.stringify(model.value);
      expect(serialized).toContain("Refrigerator water filter");
      expect(serialized).not.toContain(ASSET_ID);
    });

    it("frames proposals as tentative review cards, never as active actions", () => {
      const model = modelOutput(proposeAssetActionsTool.toModelOutput, {
        found: true,
        proposed: [{ action: gaRef("suggested") }],
        asset: { id: ASSET_ID, name: "Refrigerator water filter" },
      });

      const guidance = (model.value as { guidance: string }).guidance;
      expect(guidance).toMatch(/TENTATIVE/);
      expect(guidance).toMatch(/accept/i);
      expect(guidance).toMatch(/not active actions until/i);
    });

    it("tells the model to say so plainly when a pass proposes nothing", () => {
      // An empty pass on an asset with no timed detail is a calm, correct answer. The model
      // must not paper over it by inventing a reminder.
      const model = modelOutput(proposeAssetActionsTool.toModelOutput, {
        found: true,
        proposed: [],
        alreadySpokenFor: 0,
        asset: { id: ASSET_ID, name: "Refrigerator water filter" },
      });

      const value = model.value as { proposed: unknown[]; guidance: string };
      expect(value.proposed).toEqual([]);
      expect(value.guidance).toMatch(/do not invent a reminder/i);
    });

    it("says WHY an empty pass was empty, so the model cannot invent a reason", () => {
      // The two empty passes are different sentences, and the seam already knows which is
      // which. Given only "nothing to propose", the model made a reason up — it told the user
      // their recurring detail was "missing a date" and offered to fix it, which is both false
      // and, since the user had dismissed that very reminder, the start of a nag.
      const model = modelOutput(proposeAssetActionsTool.toModelOutput, {
        found: true,
        proposed: [],
        alreadySpokenFor: 1,
        asset: { id: ASSET_ID, name: "Toyota Corolla" },
      });

      const guidance = (model.value as { guidance: string }).guidance;
      expect(guidance).toMatch(/already (proposed|dealt with)/i);
      expect(guidance).toMatch(/do NOT re-propose/i);
      expect(guidance).toMatch(/do NOT invent a reason/i);
    });
  });
});

/**
 * The twin that had drifted. `dismiss_suggested_followup` strips its ids and says
 * what happened; `dismiss_suggested_memory` had no projection at all, so the raw
 * memory id, person id, and source-record id went straight into the model's context
 * for a call whose whole result is "it is gone".
 */
describe("dismiss_suggested_memory toModelOutput matches its twin", () => {
  const MEM_ID = "99999999-9999-4999-8999-999999999999";
  const rawOutput = {
    memory: {
      id: MEM_ID,
      personId: PERSON_ID,
      status: "dismissed",
      sourceRecordId: SOURCE_ID,
    },
  };

  it("keeps the new status and strips every raw id", () => {
    const model = modelOutput(dismissSuggestedMemoryTool.toModelOutput, rawOutput);
    const serialized = JSON.stringify(model.value);

    expect(model.type).toBe("json");
    expect(serialized).toContain("dismissed");
    expect(serialized).not.toContain(MEM_ID);
    expect(serialized).not.toContain(PERSON_ID);
    expect(serialized).not.toContain(SOURCE_ID);
  });

  it("leaves the channel's copy of the ids untouched", () => {
    modelOutput(dismissSuggestedMemoryTool.toModelOutput, rawOutput);

    expect(rawOutput.memory.id).toBe(MEM_ID);
    expect(rawOutput.memory.sourceRecordId).toBe(SOURCE_ID);
  });
});
