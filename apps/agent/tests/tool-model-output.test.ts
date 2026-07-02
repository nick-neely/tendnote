import { describe, expect, it } from "vitest";
import acceptSuggestedFollowupTool from "../agent/tools/accept_suggested_followup";
import approveSuggestedMemoryTool from "../agent/tools/approve_suggested_memory";
import captureMemoryTool from "../agent/tools/capture_memory";
import captureSourceRecordTool from "../agent/tools/capture_source_record";
import createMessageDraftTool from "../agent/tools/create_message_draft";
import createPersonTool from "../agent/tools/create_person";
import agendaTool from "../agent/tools/get_relationship_agenda";
import getSuggestedFollowupReviewTool from "../agent/tools/get_suggested_followup_review";
import getSuggestedMemoryReviewTool from "../agent/tools/get_suggested_memory_review";
import listSuggestedFollowupReviewsTool from "../agent/tools/list_suggested_followup_reviews";
import listSuggestedMemoryReviewsTool from "../agent/tools/list_suggested_memory_reviews";
import proposeFollowupTool from "../agent/tools/propose_followup";
import exactSearchTool from "../agent/tools/search_relationship_context";
import semanticSearchTool from "../agent/tools/search_semantic_context";
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
