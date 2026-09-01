import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OPAQUE_DENIAL } from "../agent/lib/approval";
import captureSavedItemTool from "../agent/tools/capture_saved_item";
import createMessageDraftTool from "../agent/tools/create_message_draft";
import getPersonContextTool from "../agent/tools/get_person_context";
import getRelationshipAgendaTool from "../agent/tools/get_relationship_agenda";
import planSuggestedGeneralActionsTool from "../agent/tools/plan_suggested_general_actions";
import proposeFollowupTool from "../agent/tools/propose_followup";
import searchGlobalRecallTool from "../agent/tools/search_global_recall";
import searchRelationshipContextTool from "../agent/tools/search_relationship_context";
import searchSemanticContextTool from "../agent/tools/search_semantic_context";
import suggestGeneralActionTool from "../agent/tools/suggest_general_action";
import { runToolApproval } from "./test-tool";

/**
 * Every argument in this table used to be the model's own word that the user had
 * asked for something - restricted relationship context, a household audience, a
 * body to persist verbatim. Setting one widened what the call was allowed to do, and
 * nothing anywhere checked who had actually asked. Text the model merely *read* -
 * a pasted email, a fetched page, a household member's note - could therefore mint
 * its own permission, which is the whole shape of the deferred consent findings.
 *
 * The argument survives; what changed is what it means. Set, it now parks the call
 * for the owner to answer through the client, so the model can ask and only a person
 * can agree. Unset, the call is what it always was, for every caller including the
 * unattended ones - so the gate costs an ordinary read nothing.
 *
 * Three cases per flag, because each rules out a different way of getting this
 * wrong: parking the owner (the flag works), denying Eve's own runtime principal
 * (nobody is watching a scheduled workflow, so it must not widen and must not hang),
 * and leaving an unset call alone (the gate did not become a tax on every call).
 */
const denied = { type: "denied", reason: OPAQUE_DENIAL };

const RUNTIME_PRINCIPAL = {
  attributes: {},
  authenticator: "app",
  principalId: "eve:app",
  principalType: "runtime",
} as const;

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_RECORD_ID = "22222222-2222-4222-8222-222222222222";

type FlagCase = {
  /** The tool name, as it appears to the model. */
  name: string;
  tool: unknown;
  /** The argument that widens authority. */
  flag: string;
  /** An input with that argument set to the value that widens. */
  widening: Record<string, unknown>;
  /** The same call without it. */
  ordinary: Record<string, unknown>;
};

const FLAG_CASES: FlagCase[] = [
  {
    name: "get_person_context",
    tool: getPersonContextTool,
    flag: "includeRestricted",
    widening: { personId: PERSON_ID, includeRestricted: true },
    ordinary: { personId: PERSON_ID },
  },
  {
    name: "search_global_recall",
    tool: searchGlobalRecallTool,
    flag: "includeRestricted",
    widening: { query: "the diagnosis", family: "memory", includeRestricted: true },
    ordinary: { query: "the diagnosis", family: "memory", includeRestricted: false },
  },
  {
    name: "search_relationship_context",
    tool: searchRelationshipContextTool,
    flag: "directlyRequested",
    widening: { query: "the diagnosis", visibilityScope: "all_visible", directlyRequested: true },
    ordinary: { query: "the diagnosis", visibilityScope: "all_visible", directlyRequested: false },
  },
  {
    name: "search_semantic_context",
    tool: searchSemanticContextTool,
    flag: "directlyRequested",
    widening: { query: "the diagnosis", directlyRequested: true },
    ordinary: { query: "the diagnosis", directlyRequested: false },
  },
  {
    name: "get_relationship_agenda",
    tool: getRelationshipAgendaTool,
    flag: "directlyRequested",
    widening: {
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-08T00:00:00.000Z",
      directlyRequested: true,
    },
    ordinary: {
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-07-08T00:00:00.000Z",
    },
  },
  {
    name: "propose_followup",
    tool: proposeFollowupTool,
    flag: "directlyRequested",
    widening: {
      personId: PERSON_ID,
      reason: "check in about the diagnosis",
      dueAt: "2026-07-08T00:00:00.000Z",
      sourceRecordId: SOURCE_RECORD_ID,
      directlyRequested: true,
    },
    ordinary: {
      personId: PERSON_ID,
      reason: "check in about the move",
      dueAt: "2026-07-08T00:00:00.000Z",
      sourceRecordId: SOURCE_RECORD_ID,
    },
  },
  {
    name: "suggest_general_action",
    tool: suggestGeneralActionTool,
    flag: "directlyRequested",
    widening: {
      title: "Call the clinic",
      sourceRecordId: SOURCE_RECORD_ID,
      directlyRequested: true,
    },
    ordinary: { title: "Book the campsite", sourceRecordId: SOURCE_RECORD_ID },
  },
  {
    name: "plan_suggested_general_actions",
    tool: planSuggestedGeneralActionsTool,
    flag: "directlyRequested",
    widening: {
      sourceRecordId: SOURCE_RECORD_ID,
      steps: [{ title: "Call the clinic" }],
      directlyRequested: true,
    },
    ordinary: { sourceRecordId: SOURCE_RECORD_ID, steps: [{ title: "Book the campsite" }] },
  },
  {
    name: "create_message_draft (includeRestricted)",
    tool: createMessageDraftTool,
    flag: "includeRestricted",
    widening: { personId: PERSON_ID, includeRestricted: true },
    ordinary: { personId: PERSON_ID },
  },
  {
    name: "create_message_draft (acceptedProposal)",
    tool: createMessageDraftTool,
    flag: "acceptedProposal",
    widening: {
      personId: PERSON_ID,
      acceptedProposal: {
        body: "Hi Maya, glad the move went well.",
        sourceRefs: [
          {
            kind: "approved_memory",
            id: "memory-1",
            label: "Maya moved to Denver.",
            trust: "confirmed_fact",
          },
        ],
        digest: "not-checked-by-the-policy",
      },
    },
    ordinary: { personId: PERSON_ID },
  },
];

describe.each(FLAG_CASES)("$name: $flag asks the owner", (flagCase) => {
  it("parks the call for the signed-in owner", async () => {
    await expect(runToolApproval(flagCase.tool, { toolInput: flagCase.widening })).resolves.toBe(
      "user-approval",
    );
  });

  it("denies Eve's own runtime principal rather than widening or hanging", async () => {
    await expect(
      runToolApproval(flagCase.tool, {
        principal: RUNTIME_PRINCIPAL,
        toolInput: flagCase.widening,
      }),
    ).resolves.toEqual(denied);
  });

  it("leaves the ordinary call untouched, for the owner and the runtime alike", async () => {
    await expect(runToolApproval(flagCase.tool, { toolInput: flagCase.ordinary })).resolves.toBe(
      "not-applicable",
    );
    await expect(
      runToolApproval(flagCase.tool, {
        principal: RUNTIME_PRINCIPAL,
        toolInput: flagCase.ordinary,
      }),
    ).resolves.toBe("not-applicable");
  });
});

describe.each(FLAG_CASES)("$name: $flag on a subagent turn", (flagCase) => {
  it("is denied rather than parked, because a delegated turn has nobody to ask", async () => {
    // Every one of these is a root tool today, so this is a standing guarantee
    // rather than a live path: if one is ever registered under a subagent, the
    // widening branch fails closed instead of hanging on an approval nobody sees.
    await expect(
      runToolApproval(flagCase.tool, { subagent: true, toolInput: flagCase.widening }),
    ).resolves.toEqual(denied);
  });
});

/**
 * `requestedScope` is the one argument in this file whose tool no longer has a
 * `when` predicate at all.
 *
 * Capture is a durable write, so it parks whatever its audience
 * (`write-tool-approval.test.ts` owns that half). What survives here is the
 * description: the argument still asks for a wider audience rather than choosing
 * one, and the sentence that says so is the only place the model learns it.
 */
describe("capture_saved_item asks whatever audience it names", () => {
  it.each([
    ["a household request", "household"],
    ["the private default said out loud", "private"],
    ["no scope at all", undefined],
  ])("parks %s", async (_name, requestedScope) => {
    await expect(
      runToolApproval(captureSavedItemTool, {
        toolInput: {
          interactionId: "turn-1",
          originalText: "The recycling goes out on Tuesdays",
          ...(requestedScope === undefined ? {} : { requestedScope }),
        },
      }),
    ).resolves.toBe("user-approval");
  });
});

/**
 * The model-facing text has to change with the meaning. A description that still
 * reads "set this when the user asked" invites the model to decide on the user's
 * behalf, which is the habit the gate exists to break - and the description is the
 * only place the model learns that a decline is final.
 */
describe("the flags describe themselves as requests", () => {
  function fieldDescription(tool: unknown, field: string): string {
    const json = z.toJSONSchema((tool as { inputSchema: z.ZodType }).inputSchema, {
      io: "input",
    }) as { properties?: Record<string, { description?: string } | undefined> };
    return json.properties?.[field]?.description ?? "";
  }

  it.each([
    ["get_person_context", getPersonContextTool, "includeRestricted"],
    ["search_global_recall", searchGlobalRecallTool, "includeRestricted"],
    ["search_relationship_context", searchRelationshipContextTool, "directlyRequested"],
    ["search_semantic_context", searchSemanticContextTool, "directlyRequested"],
    ["get_relationship_agenda", getRelationshipAgendaTool, "directlyRequested"],
    ["propose_followup", proposeFollowupTool, "directlyRequested"],
    ["suggest_general_action", suggestGeneralActionTool, "directlyRequested"],
    ["plan_suggested_general_actions", planSuggestedGeneralActionsTool, "directlyRequested"],
    ["create_message_draft", createMessageDraftTool, "includeRestricted"],
    ["capture_saved_item", captureSavedItemTool, "requestedScope"],
  ] as const)("%s tells the model that %s asks rather than authorises", (_name, tool, field) => {
    const description = fieldDescription(tool, field);

    expect(description).toMatch(/REQUESTS/);
    expect(description).toMatch(/approves or declines/i);
    expect(description).toMatch(/until they answer/i);
    // A decline must end the attempt, not start a search for another route.
    expect(description).toMatch(/decline/i);
  });
});

/**
 * A subagent turn has nobody to ask: the owner's request reached the root agent, and
 * a delegated session cannot render or answer an approval. So these registrations do
 * not carry the argument at all - a set flag there could only ever be the model
 * vouching for a request it never heard, and gating it would kill the whole call
 * instead of narrowing it.
 */
describe("subagents do not get to ask for restricted context", () => {
  async function modelFacingFields(modulePath: string) {
    const { default: tool } = (await import(modulePath)) as { default: { inputSchema: z.ZodType } };
    const json = z.toJSONSchema(tool.inputSchema, { io: "input" }) as {
      properties?: Record<string, unknown>;
    };
    return Object.keys(json.properties ?? {});
  }

  it.each([
    [
      "relationship_strategist/get_relationship_agenda",
      "../agent/subagents/relationship_strategist/tools/get_relationship_agenda",
      "directlyRequested",
    ],
    [
      "relationship_strategist/propose_followup",
      "../agent/subagents/relationship_strategist/tools/propose_followup",
      "directlyRequested",
    ],
    [
      "message_drafter/propose_message_draft",
      "../agent/subagents/message_drafter/tools/propose_message_draft",
      "includeRestricted",
    ],
  ] as const)("%s does not offer %s", async (_name, modulePath, field) => {
    expect(await modelFacingFields(modulePath)).not.toContain(field);
  });

  it("keeps the flag on the root registrations of the same shared tools", async () => {
    // The shared definition is registered twice; only the root's copy asks, because
    // only the root's session has somebody to answer.
    expect(await modelFacingFields("../agent/tools/get_relationship_agenda")).toContain(
      "directlyRequested",
    );
    expect(await modelFacingFields("../agent/tools/propose_followup")).toContain(
      "directlyRequested",
    );
  });
});
