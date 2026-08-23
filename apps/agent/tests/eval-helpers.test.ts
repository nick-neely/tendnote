import type { AssertionHandle, EveEvalAssertions } from "eve/evals";
import { describe, expect, it } from "vitest";
import { isDraftRevisionReplyCanonical } from "../evals/behavior/draft-revision-assertions";
import { isUnfiledActionReplyTruthful } from "../evals/behavior/general-action-area-filing.eval";
import {
  assistantMessageMatches,
  requestedQuestionMatches,
} from "../evals/behavior/general-action-mutation-boundary.eval";
import {
  curatorProposalCount,
  memoryCleanupReplyMatchesCount,
} from "../evals/behavior/memory-curator-routing.eval";
import { statesPurchaseLocationLimitation } from "../evals/behavior/phase-seven-recall-limitations.eval";
import {
  hasCapturePersonClarification,
  hasFields,
  hasFollowupLifecycleState,
  hasGroundedPendingAssetProposal,
  hasGroundedSuggestedMemoryProposal,
  hasNoRuntimeFailures,
  hasReviewGatedGeneralActionPlan,
  isEmptyArray,
  isNonEmptyUuidArray,
  isPrivateOrOmitted,
  isSemanticClarification,
  someToolOutputHasFields,
  toolOutputs,
} from "../evals/expectations";
import {
  firstSubagentIndex,
  firstToolRequestIndex,
  notCalledSubagent,
  usedNoSubagents,
  usedSubagent,
  usesOnlyAllowedTools,
} from "../evals/helpers";
import { isPendingAssetReviewReply } from "../evals/policy/asset-durable-write-boundary.eval";

/**
 * The eval helpers are the only place an eval can see a subagent, so their blind
 * spots are the suite's blind spots. eve emits a delegation four different ways
 * depending on how it ran, and a predicate that knows about two of them is how
 * `notCalledTool("privacy_guard")` came to pass on every run ever recorded.
 */

/** Records what the eval scope was asked, and answers with the predicate's verdict. */
function recordingScope(events: readonly unknown[]) {
  const recorded: Array<{ label: string; passed: boolean }> = [];
  const handle = {
    gate: () => handle,
    soft: () => handle,
    atLeast: () => handle,
    label: () => handle,
  };
  const scope = {
    eventsSatisfy(label: string, predicate: (events: never) => boolean) {
      recorded.push({ label, passed: predicate(events as never) });
      return handle as unknown as AssertionHandle;
    },
    usedNoTools() {
      recorded.push({ label: "usedNoTools", passed: true });
      return handle as unknown as AssertionHandle;
    },
  } as unknown as EveEvalAssertions;

  return { scope, recorded };
}

const workflowCall = {
  type: "subagent.called",
  data: { name: "privacy_guard", callId: "1", toolName: "privacy_guard" },
};
const inlineStart = {
  type: "subagent.started",
  data: { callId: "2", subagentName: "privacy_guard" },
};
const inlineDone = {
  type: "subagent.completed",
  data: { callId: "2", subagentName: "memory_curator", output: "" },
};
const toolRequest = {
  type: "actions.requested",
  data: { actions: [{ kind: "tool-call", toolName: "search_people" }] },
};

describe("eval subagent visibility", () => {
  it("sees a delegation whether it ran as a child workflow or inline", () => {
    expect(usedSubagent([workflowCall], "privacy_guard")).toBe(true);
    expect(usedSubagent([inlineStart], "privacy_guard")).toBe(true);
    expect(usedSubagent([inlineDone], "memory_curator")).toBe(true);
    expect(usedSubagent([toolRequest], "privacy_guard")).toBe(false);
  });

  it("fails notCalledSubagent for either delegation shape", () => {
    for (const event of [workflowCall, inlineStart]) {
      const { scope, recorded } = recordingScope([toolRequest, event]);
      notCalledSubagent(scope, "privacy_guard");
      expect(recorded).toEqual([
        { label: "did not delegate to the privacy_guard subagent", passed: false },
      ]);
    }
  });

  it("passes notCalledSubagent when a different subagent ran", () => {
    const { scope, recorded } = recordingScope([inlineDone]);
    notCalledSubagent(scope, "privacy_guard");
    expect(recorded[0]?.passed).toBe(true);
  });

  it("fails usedNoSubagents on any delegation at all", () => {
    expect(recordedVerdict([toolRequest])).toBe(true);
    expect(recordedVerdict([toolRequest, inlineDone])).toBe(false);
  });

  it("reads a tool result whether the turn ran it directly or delegated it", () => {
    const direct = {
      type: "action.result",
      data: { result: { toolName: "get_relationship_agenda", output: { candidates: ["direct"] } } },
    };
    const delegated = {
      type: "subagent.event",
      data: {
        callId: "3",
        subagentName: "relationship_strategist",
        event: {
          type: "action.result",
          data: {
            toolName: "get_relationship_agenda",
            result: { toolName: "get_relationship_agenda", output: { candidates: ["delegated"] } },
          },
        },
      },
    };

    // The delegated case is the one that used to come back empty, so a judged eval
    // graded a correctly routed answer against no records at all.
    expect(toolOutputs([direct], "get_relationship_agenda")).toEqual([{ candidates: ["direct"] }]);
    expect(toolOutputs([delegated], "get_relationship_agenda")).toEqual([
      { candidates: ["delegated"] },
    ]);
    expect(toolOutputs([direct, delegated], "list_due_followups")).toEqual([]);
    expect(toolOutputs([toolRequest, { type: "subagent.event", data: {} }, null], "x")).toEqual([]);
  });

  it("reports stream order for tools and subagents", () => {
    const events = [toolRequest, workflowCall];
    expect(firstToolRequestIndex(events, "search_people")).toBe(0);
    expect(firstSubagentIndex(events, "privacy_guard")).toBe(1);
    expect(firstToolRequestIndex(events, "capture_memory")).toBe(-1);
    expect(firstSubagentIndex(events, "message_drafter")).toBe(-1);
  });
});

describe("offline evaluator capability allowlists", () => {
  const action = (toolName: string) => ({
    type: "actions.requested",
    data: { actions: [{ kind: "tool-call", toolName }] },
  });

  it("accepts framework grounding calls but rejects an unlisted capability", () => {
    expect(
      usesOnlyAllowedTools(
        [action("load_skill"), action("search_assets")],
        ["load_skill", "search_assets"],
      ),
    ).toBe(true);
    expect(
      usesOnlyAllowedTools(
        [action("load_skill"), action("create_asset")],
        ["load_skill", "search_assets"],
      ),
    ).toBe(false);
  });

  it("sees a nested mutating call instead of treating delegation as no tools", () => {
    expect(
      usesOnlyAllowedTools(
        [
          {
            type: "subagent.event",
            data: { event: action("create_asset") },
          },
        ],
        ["load_skill", "search_assets"],
      ),
    ).toBe(false);
  });
});

describe("review-card and follow-up lifecycle projections", () => {
  const result = (toolName: string, output: unknown) => ({
    type: "action.result",
    data: { result: { toolName, output } },
  });

  it("grades review cards from the planning tool output, not repeated prose", () => {
    const sourceRecordId = "33333333-3333-4333-8333-333333333333";
    expect(
      hasReviewGatedGeneralActionPlan([
        result("capture_source_record", {
          sourceRecord: { id: sourceRecordId, content: "A planning note" },
        }),
        result("plan_suggested_general_actions", {
          found: true,
          count: 2,
          proposed: [
            {
              component: {
                type: "suggested_general_action_review",
                sourceRecordId,
              },
              action: {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Reserve the campsite",
                status: "suggested",
              },
            },
            {
              component: {
                type: "suggested_general_action_review",
                sourceRecordId,
              },
              action: {
                id: "22222222-2222-4222-8222-222222222222",
                title: "Pack the gear",
                status: "suggested",
              },
            },
          ],
        }),
      ]),
    ).toBe(true);
  });

  it("rejects an active or incomplete planning result", () => {
    const sourceRecordId = "33333333-3333-4333-8333-333333333333";
    expect(
      hasReviewGatedGeneralActionPlan([
        result("capture_source_record", {
          sourceRecord: { id: sourceRecordId, content: "A planning note" },
        }),
        result("plan_suggested_general_actions", {
          found: true,
          count: 1,
          proposed: [
            {
              component: { type: "suggested_general_action_review", sourceRecordId },
              action: {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Reserve the campsite",
                status: "open",
              },
            },
          ],
        }),
        result("plan_suggested_general_actions", { found: true, count: 1, proposed: [] }),
      ]),
    ).toBe(false);
  });

  it("rejects review cards grounded in a different source record", () => {
    expect(
      hasReviewGatedGeneralActionPlan([
        result("capture_source_record", {
          sourceRecord: {
            id: "33333333-3333-4333-8333-333333333333",
            content: "The captured planning note",
          },
        }),
        result("plan_suggested_general_actions", {
          found: true,
          count: 1,
          proposed: [
            {
              component: {
                type: "suggested_general_action_review",
                sourceRecordId: "66666666-6666-4666-8666-666666666666",
              },
              action: {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Reserve the campsite",
                status: "suggested",
              },
            },
          ],
        }),
      ]),
    ).toBe(false);
  });

  it("proves create, read, and snooze states share one follow-up", () => {
    const followupId = "44444444-4444-4444-8444-444444444444";
    expect(
      hasFollowupLifecycleState(
        [
          result("create_followup", {
            followup: {
              id: followupId,
              reason: "Send the ops notes question",
              dueAt: "2026-08-25T00:00:00.000Z",
              status: "open",
            },
          }),
        ],
        "create_followup",
        { id: followupId, dueAt: /^2026-08-25/, status: "open" },
      ),
    ).toBe(true);
    expect(
      hasFollowupLifecycleState(
        [
          result("list_due_followups", {
            followups: [
              {
                id: followupId,
                reason: "Send the ops notes question",
                dueAt: "2026-08-25T00:00:00.000Z",
                status: "open",
              },
            ],
          }),
        ],
        "list_due_followups",
        { id: followupId, reason: /ops notes/, dueAt: /^2026-08-25/, status: "open" },
      ),
    ).toBe(true);
    expect(
      hasFollowupLifecycleState(
        [
          result("update_followup_status", {
            followup: {
              id: followupId,
              reason: "Send the ops notes question",
              dueAt: "2026-08-31T00:00:00.000Z",
              status: "snoozed",
            },
          }),
        ],
        "update_followup_status",
        { id: followupId, dueAt: /^2026-08-31/, status: "snoozed" },
      ),
    ).toBe(true);
  });

  it("rejects a snooze state for a different follow-up or due date", () => {
    expect(
      hasFollowupLifecycleState(
        [
          result("update_followup_status", {
            followup: {
              id: "55555555-5555-4555-8555-555555555555",
              dueAt: "2026-08-31T00:00:00.000Z",
              status: "snoozed",
            },
          }),
        ],
        "update_followup_status",
        {
          id: "44444444-4444-4444-8444-444444444444",
          dueAt: /^2026-08-31/,
          status: "snoozed",
        },
      ),
    ).toBe(false);
  });
});

describe("semantic clarification and parked-question projections", () => {
  it("accepts the preserved hand-back without punctuation", () => {
    expect(
      isSemanticClarification(
        "Let me know which specific items you'd like to mark complete, dismiss, or edit.",
      ),
    ).toBe(true);
    expect(isSemanticClarification("I've tidied everything for you.")).toBe(false);
  });

  it("reads both action requests and the durable HITL request", () => {
    const pattern = /when|which|specific/i;
    expect(
      requestedQuestionMatches(
        [
          {
            type: "actions.requested",
            data: {
              actions: [
                { toolName: "ask_question", input: { prompt: "When should it resurface?" } },
              ],
            },
          },
        ],
        pattern,
      ),
    ).toBe(true);
    expect(
      requestedQuestionMatches(
        [
          {
            type: "input.requested",
            data: {
              requests: [
                { kind: "question", toolName: "ask_question", prompt: "Which date works?" },
              ],
            },
          },
        ],
        pattern,
      ),
    ).toBe(true);
    expect(
      requestedQuestionMatches(
        [
          {
            type: "input.requested",
            data: {
              requests: [{ kind: "question", toolName: "ask_question", prompt: "Continue?" }],
            },
          },
        ],
        pattern,
      ),
    ).toBe(false);
  });

  it("can grade a prose clarification from a message event", () => {
    expect(
      assistantMessageMatches(
        [
          {
            type: "message.completed",
            data: { message: "Tell me which date you want for the reminder." },
          },
        ],
        /which date/i,
      ),
    ).toBe(true);
    expect(
      assistantMessageMatches(
        [{ type: "message.completed", data: { message: "Done." } }],
        /which date/i,
      ),
    ).toBe(false);
  });
});

describe("asset proposal eval grounding", () => {
  const assetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const memoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const result = (toolName: string, output: unknown) => ({
    type: "action.result",
    data: { result: { toolName, output } },
  });
  const searchAnchor = result("search_assets", {
    results: [
      {
        recordKind: "asset",
        assetId,
        assetName: "Kitchen refrigerator",
      },
    ],
  });
  const proposal = result("propose_asset_actions", {
    asset: { id: assetId },
    pending: [
      {
        assetMemoryId: memoryId,
        action: { status: "suggested" },
      },
    ],
  });

  it("accepts a reviewed detail loaded after search resolves the Asset anchor", () => {
    const context = result("get_asset_context", {
      assetId,
      facts: [{ memoryId, label: "Warranty expires" }],
    });

    expect(
      hasGroundedPendingAssetProposal([searchAnchor, context, proposal], {
        assetName: "Kitchen refrigerator",
        detailLabel: /warranty/i,
      }),
    ).toBe(true);
  });

  it("rejects a proposal whose pending action is not grounded in that reviewed detail", () => {
    const context = result("get_asset_context", {
      assetId,
      facts: [{ memoryId, label: "Warranty expires" }],
    });
    const mismatchedProposal = result("propose_asset_actions", {
      asset: { id: assetId },
      pending: [
        {
          assetMemoryId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          action: { status: "suggested" },
        },
      ],
    });

    expect(
      hasGroundedPendingAssetProposal([searchAnchor, context, mismatchedProposal], {
        assetName: "Kitchen refrigerator",
        detailLabel: /warranty/i,
      }),
    ).toBe(false);
  });
});

describe("asset proposal reviewed-memory input", () => {
  const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("accepts singleton and multiple reviewed UUIDs", () => {
    expect(isNonEmptyUuidArray([first])).toBe(true);
    expect(isNonEmptyUuidArray([first, second])).toBe(true);
  });

  it("rejects empty, invalid, and mixed grounding arrays", () => {
    expect(isNonEmptyUuidArray([])).toBe(false);
    expect(isNonEmptyUuidArray(["not-a-uuid"])).toBe(false);
    expect(isNonEmptyUuidArray([first, "not-a-uuid"])).toBe(false);
  });
});

describe("Capture private-default evaluation contract", () => {
  it("accepts an omitted or explicit private scope and rejects every widening", () => {
    expect(isPrivateOrOmitted(undefined)).toBe(true);
    expect(isPrivateOrOmitted("private")).toBe(true);
    expect(isPrivateOrOmitted("household")).toBe(false);
    expect(isPrivateOrOmitted("shared")).toBe(false);
    expect(isPrivateOrOmitted("unknown")).toBe(false);
    expect(isPrivateOrOmitted(null)).toBe(false);
  });

  it("recognizes only the owning Capture tool's Person clarification", () => {
    const result = (toolName: string, output: unknown) => ({
      type: "action.result",
      data: { result: { toolName, output } },
    });
    expect(
      hasCapturePersonClarification([
        result("capture_saved_item", {
          clarification: { field: "person", question: "Who did you mean by Priya?" },
        }),
      ]),
    ).toBe(true);
    expect(
      hasCapturePersonClarification([
        result("capture_saved_item", {
          clarification: { field: "timing", question: "When?" },
        }),
      ]),
    ).toBe(false);
    expect(
      hasCapturePersonClarification([
        result("capture_memory", {
          clarification: { field: "person", question: "Who?" },
        }),
      ]),
    ).toBe(false);
  });

  it("accepts a healthy parked clarification but rejects runtime failures", () => {
    expect(
      hasNoRuntimeFailures([
        { type: "session.waiting", data: { wait: "input" } },
        { type: "action.result", data: { status: "completed" } },
      ]),
    ).toBe(true);
    expect(hasNoRuntimeFailures([{ type: "session.failed", data: { error: "boom" } }])).toBe(false);
    expect(
      hasNoRuntimeFailures([{ type: "subagent.event", data: { event: { type: "step.errored" } } }]),
    ).toBe(false);
  });
});

describe("memory cleanup reply contract", () => {
  it("accepts a truthful empty result without requiring review language", () => {
    expect(
      memoryCleanupReplyMatchesCount(
        "I checked for stale, duplicate, or contradictory memories and found none.",
        0,
      ),
    ).toBe(true);
    expect(
      memoryCleanupReplyMatchesCount(
        "Everything looks clear and consistent. There are currently no duplicate, stale, or contradictory memories flagged for cleanup.",
        0,
      ),
    ).toBe(true);
    expect(
      memoryCleanupReplyMatchesCount(
        "There are no duplicate memories, but I found one suggestion.",
        0,
      ),
    ).toBe(false);
  });

  it("requires review language when cleanup proposals exist", () => {
    expect(memoryCleanupReplyMatchesCount("I found two suggestions for your review.", 2)).toBe(
      true,
    );
    expect(memoryCleanupReplyMatchesCount("I found two cleanup candidates.", 2)).toBe(false);
  });

  it("reads exactly one parent-visible curator count marker", () => {
    expect(
      curatorProposalCount([
        {
          type: "subagent.completed",
          data: { subagentName: "memory_curator", output: "PROPOSAL_COUNT: 0\nNothing found." },
        },
      ]),
    ).toBe(0);
    expect(curatorProposalCount([])).toBeNull();
  });
});

describe("final qualification semantic predicates", () => {
  it("accepts parked Action questions only when their prompt is specific", () => {
    const event = (prompt: string) => ({
      type: "actions.requested",
      data: { actions: [{ toolName: "ask_question", input: { prompt } }] },
    });
    expect(requestedQuestionMatches([event("Which Action did you finish?")], /which/i)).toBe(true);
    expect(requestedQuestionMatches([event("Continue?")], /which/i)).toBe(false);
  });

  it("distinguishes pending Asset review from an already-saved claim", () => {
    expect(
      isPendingAssetReviewReply(
        "It's waiting for your review before it is saved as a confirmed fact.",
      ),
    ).toBe(true);
    expect(isPendingAssetReviewReply("I've saved it; it is waiting for review.")).toBe(false);
  });

  it("accepts explicit purchase-location limitations, not retailer claims", () => {
    expect(
      statesPurchaseLocationLimitation(
        "I can't confirm where to buy it, so I won't recommend a store.",
      ),
    ).toBe(true);
    expect(statesPurchaseLocationLimitation("You can buy it from Home Depot.")).toBe(false);
  });
});

describe("draft revision reply contract", () => {
  it("accepts only the canonical unapproved confirmation", () => {
    expect(
      isDraftRevisionReplyCanonical(
        "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft.",
        "draft",
      ),
    ).toBe(true);
    expect(
      isDraftRevisionReplyCanonical(
        "Updated the draft to Casey — it now reads: \"Happy birthday, Casey. Hope today is easy and full of good coffee. Let's grab coffee sometime soon if you're up for it — my treat.\"\n\nIt's still just an unapproved Tendnote draft — nothing's been approved, exported, or sent.",
        "draft",
      ),
    ).toBe(true);
  });

  it("accepts the canonical prior-approval nuance only for an approved draft", () => {
    expect(
      isDraftRevisionReplyCanonical(
        "Updated the internal Tendnote draft; its prior approval no longer covers this wording, nothing was exported or sent, and it is not an external or Gmail draft.",
        "approved",
      ),
    ).toBe(true);
  });

  it("rejects contradictory or extra clauses instead of parsing prose claims", () => {
    for (const adversarialReply of [
      "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft. It is ready to send.",
      "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft, but I sent it.",
      "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft. I also created an external draft.",
      "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft. I put the revision in a Gmail draft.",
      "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft. I exported it.",
      "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft. It's on its way.",
      "Updated the internal Tendnote draft; its prior approval no longer covers this wording, nothing was exported or sent, and it is not an external or Gmail draft, but it is approved.",
      "I didn't send it, but it was sent.",
      "The prior approval no longer covers this wording, and it is approved.",
      "It's an unapproved Tendnote draft — nothing's been approved, exported, or sent. It is ready to send.",
      "It's an unapproved Tendnote draft — nothing's been approved, exported, or sent. The revision is approved.",
      "It's an unapproved Tendnote draft — nothing's been approved, exported, or sent. I created an external draft too.",
      "It's an unapproved Tendnote draft — nothing's been approved, exported, or sent. A Gmail draft is ready.",
      "It's an unapproved Tendnote draft — nothing's been approved, exported, or sent. I saved it to Gmail.",
      "It's an unapproved Tendnote draft — nothing's been approved, exported, or sent. It was sent afterward.",
      "It's an unapproved draft — nothing's been approved, exported, or sent.",
      "It's an unapproved Tendnote draft, and it wasn't sent.",
    ]) {
      expect(isDraftRevisionReplyCanonical(adversarialReply, "draft")).toBe(false);
    }
  });

  it("rejects punctuation substitutions that would match an unescaped terminal period", () => {
    expect(
      isDraftRevisionReplyCanonical(
        "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft!",
        "draft",
      ),
    ).toBe(false);
    expect(
      isDraftRevisionReplyCanonical(
        "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draftX",
        "draft",
      ),
    ).toBe(false);
  });

  it.each([
    "Added the action unfiled; no Area was assigned. Once you open Actions in the app and set up your Home area, you can file it there.",
    'Done! I\'ve added "Descale the kettle" to your action list. Once you create a Home area in the app, you can move it there.',
    "Done—**Descale the kettle** is on your active list. Once you set up your Areas in the app, you'll be able to move it to Home from there.",
    "Descale the kettle appears in your action list without an Area.",
    "Done. The action is on your ledger now — you can file it under Home from the Actions surface once you set up your Areas there.",
    "Done! The action is on your list. Once you create a Home area, you can move it there.",
    "Added the Action unfiled; no Home area exists yet to file into. Areas get set up the first time you open Actions in the app — you can create one there and I can re-file it once it exists.",
    "I added Descale the kettle to your active Actions. There isn't a Home area in Tendnote yet, so I saved it unfiled. You can file it under Home later from the Actions page once that area exists.",
  ])("accepts truthful completed unfiled Action guidance: %s", (reply) => {
    expect(isUnfiledActionReplyTruthful(reply)).toBe(true);
  });

  it.each([
    "Added the Action unfiled; no Area was assigned. I filed it under Home.",
    "I saved it unfiled. I also filed it under Home.",
    "Added the Action unfiled; no Area was assigned. The action was assigned to Home.",
    "Added the Action unfiled; no Area was assigned. Saved it under Home.",
    "Added the Action unfiled; no Area was assigned. Put it in your Home area.",
    "Added the Action unfiled; no Area was assigned. Placed it under Home.",
    "Added the Action unfiled; no Area was assigned. I can create a new Area.",
    "I can add Descale the kettle unfiled once you confirm.",
    "I can create the Action unfiled once you confirm.",
    "You can create the Action after you confirm.",
    "You can save this action once you set up Home.",
    "I didn't add Descale the kettle; no Area was assigned.",
    'Done! I\'ve added "Descale the kettle" to your action list.',
    'Done! I\'ve added "Descale the kettle" under Home. Once you create another area, you can move it there.',
    "Descale the kettle will appear in your action list without an Area.",
    "Descale the kettle is ready to add unfiled. Would you like me to do that?",
  ])("rejects pending or false-filing Action guidance: %s", (reply) => {
    expect(isUnfiledActionReplyTruthful(reply)).toBe(false);
  });
});

function recordedVerdict(events: readonly unknown[]): boolean {
  const { scope, recorded } = recordingScope(events);
  usedNoSubagents(scope);
  return recorded[0]?.passed ?? false;
}

/**
 * The field-shape and grounding predicates used to live inside individual eval
 * files, where nothing could exercise them: `eve eval` runs those files, vitest
 * never does. A predicate that quietly returns true is a gate that passes on
 * every run, so the shared versions are pinned here.
 */
describe("tool output field expectations", () => {
  const result = (toolName: string, output: unknown) => ({
    type: "action.result",
    data: { result: { toolName, output } },
  });

  it("matches exact field values and rejects near misses", () => {
    expect(hasFields({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
    expect(hasFields({ a: 1, b: "x" }, { a: 1, b: "y" })).toBe(false);
    expect(hasFields({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(hasFields({ a: "1" }, { a: 1 })).toBe(false);
    expect(hasFields(null, { a: 1 })).toBe(false);
    expect(hasFields("nope", { a: 1 })).toBe(false);
  });

  it("calls a function expectation with the field instead of comparing it", () => {
    expect(hasFields({ areas: [] }, { areas: isEmptyArray })).toBe(true);
    expect(hasFields({ areas: [1] }, { areas: isEmptyArray })).toBe(false);
    expect(hasFields({ areas: null }, { areas: isEmptyArray })).toBe(false);
    expect(isEmptyArray([])).toBe(true);
    expect(isEmptyArray({})).toBe(false);
  });

  it("walks into a nested record and fails closed when the path is absent", () => {
    const events = [result("create_general_action", { action: { areaId: null, status: "open" } })];
    expect(
      someToolOutputHasFields(
        events,
        "create_general_action",
        { areaId: null, status: "open" },
        "action",
      ),
    ).toBe(true);
    expect(
      someToolOutputHasFields(
        events,
        "create_general_action",
        { areaId: null, status: "done" },
        "action",
      ),
    ).toBe(false);
    expect(
      someToolOutputHasFields(events, "create_general_action", { areaId: null }, "missing"),
    ).toBe(false);
    expect(someToolOutputHasFields(events, "other_tool", { areaId: null }, "action")).toBe(false);
    expect(someToolOutputHasFields([], "create_general_action", { areaId: null })).toBe(false);
  });
});

describe("grounded Suggested Memory proposal", () => {
  const PERSON = "11111111-1111-4111-8111-111111111111";
  const SOURCE = "22222222-2222-4222-8222-222222222222";
  const result = (toolName: string, output: unknown) => ({
    type: "action.result",
    data: { result: { toolName, output } },
  });

  const groundedEvents = (
    overrides: {
      search?: Record<string, unknown>;
      capture?: Record<string, unknown>;
      proposal?: Record<string, unknown>;
    } = {},
  ) => [
    result("search_people", {
      requiresDisambiguation: false,
      people: [{ id: PERSON }],
      ...overrides.search,
    }),
    result("capture_source_record", {
      sourceRecord: { id: SOURCE },
      linkedPersonId: PERSON,
      ...overrides.capture,
    }),
    result("propose_suggested_memory", {
      sourceRecord: { id: SOURCE },
      memory: { sourceRecordId: SOURCE, personId: PERSON, status: "suggested" },
      component: { type: "suggested_memory_review" },
      ...overrides.proposal,
    }),
  ];

  it("accepts a proposal tied to the exact resolved person and source record", () => {
    expect(hasGroundedSuggestedMemoryProposal(groundedEvents())).toBe(true);
  });

  it("refuses an ungrounded, ambiguous, approved, or uncorrelated proposal", () => {
    expect(hasGroundedSuggestedMemoryProposal([])).toBe(false);
    expect(
      hasGroundedSuggestedMemoryProposal(
        groundedEvents({ search: { requiresDisambiguation: true } }),
      ),
    ).toBe(false);
    expect(
      hasGroundedSuggestedMemoryProposal(
        groundedEvents({ search: { people: [{ id: PERSON }, { id: SOURCE }] } }),
      ),
    ).toBe(false);
    expect(
      hasGroundedSuggestedMemoryProposal(groundedEvents({ capture: { linkedPersonId: SOURCE } })),
    ).toBe(false);
    expect(
      hasGroundedSuggestedMemoryProposal(
        groundedEvents({
          proposal: {
            sourceRecord: { id: SOURCE },
            memory: { sourceRecordId: SOURCE, personId: PERSON, status: "approved" },
            component: { type: "suggested_memory_review" },
          },
        }),
      ),
    ).toBe(false);
    expect(
      hasGroundedSuggestedMemoryProposal(
        groundedEvents({
          proposal: {
            sourceRecord: { id: PERSON },
            memory: { sourceRecordId: SOURCE, personId: PERSON, status: "suggested" },
            component: { type: "suggested_memory_review" },
          },
        }),
      ),
    ).toBe(false);
    expect(
      hasGroundedSuggestedMemoryProposal(
        groundedEvents({ proposal: { component: { type: "plain_text" } } }),
      ),
    ).toBe(false);
  });
});
