import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import { approveOptionId, pendingApprovalRequests, typedApprovalAnswer } from "./approval-answers";
import type { AssistantInputRequestView } from "./input-request-view";

/**
 * The composer's shortcut, and the one rule it must not break: a typed word is
 * *matched* against the ids eve offered, never mapped onto one. A word that matches
 * nothing is a message, and a message while a turn is parked cancels the approval -
 * so guessing wrong here is not a cosmetic failure.
 */

const REQUEST: AssistantInputRequestView = {
  requestId: "req-1",
  toolCallId: "call-1",
  toolName: "capture_memory",
  kind: "tool-approval",
  prompt: "Approve tool call: capture_memory",
  display: "confirmation",
  allowFreeform: false,
  options: [
    { id: "approve", label: "Approve", description: null, style: "default" },
    { id: "cancel", label: "Cancel", description: null, style: "default" },
  ],
  fields: [],
  input: {},
};

function parkedPart(toolCallId: string, requestId: string, toolName: string) {
  return {
    type: "dynamic-tool" as const,
    toolCallId,
    toolName,
    state: "approval-requested" as const,
    approval: { id: requestId },
    input: {},
    toolMetadata: {
      eve: {
        kind: "tool-call" as const,
        name: toolName,
        inputRequest: {
          kind: "tool-approval" as const,
          requestId,
          prompt: `Approve tool call: ${toolName}`,
          display: "confirmation" as const,
          allowFreeform: false,
          options: [
            { id: "approve", label: "Approve" },
            { id: "cancel", label: "Cancel" },
          ],
        },
      },
    },
  };
}

describe("typedApprovalAnswer", () => {
  it.each(["approve", "Approve", "  cancel  ", "CANCEL"])(
    "answers with the option whose id the owner typed (%s)",
    (typed) => {
      expect(typedApprovalAnswer(REQUEST, typed)).toBe(typed.trim().toLowerCase());
    },
  );

  it.each(["approve it", "yes", "cancel the fetch but keep the save", "", "approved"])(
    "leaves anything else to be sent as a message (%s)",
    (typed) => {
      expect(typedApprovalAnswer(REQUEST, typed)).toBeNull();
    },
  );

  /** Matching, never mapping: a request that offers no `approve` cannot be approved. */
  it("answers with nothing when the request does not offer that option", () => {
    const refusalOnly = {
      ...REQUEST,
      options: [{ id: "cancel", label: "Cancel", description: null, style: "default" as const }],
    };

    expect(typedApprovalAnswer(refusalOnly, "approve")).toBeNull();
    expect(typedApprovalAnswer(refusalOnly, "cancel")).toBe("cancel");
  });
});

describe("approveOptionId", () => {
  it("is eve's own affirmative id when the request offers it", () => {
    expect(approveOptionId(REQUEST)).toBe("approve");
  });

  it("is nothing when it does not, so no shortcut can invent one", () => {
    expect(approveOptionId({ ...REQUEST, options: [] })).toBeNull();
  });
});

describe("pendingApprovalRequests", () => {
  it("lists the parked approvals in the order the turn parked them", () => {
    const messages: EveMessage[] = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "Save both." }] },
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "text", text: "Two things to check.", state: "done" },
          parkedPart("call-1", "req-1", "capture_memory"),
          parkedPart("call-2", "req-2", "create_followup"),
        ],
      },
    ];

    expect(pendingApprovalRequests(messages).map((it) => it.requestId)).toEqual(["req-1", "req-2"]);
  });

  /**
   * A question is the model's own words with the model's own options; eve matches a
   * typed follow-up against those itself. The composer's shortcut stays out of it.
   */
  it("leaves questions out", () => {
    const asking = parkedPart("call-1", "req-1", "ask_question");
    const messages: EveMessage[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            ...asking,
            toolMetadata: {
              eve: {
                ...asking.toolMetadata.eve,
                inputRequest: {
                  ...asking.toolMetadata.eve.inputRequest,
                  kind: "question" as const,
                  prompt: "Which Mara did you mean?",
                },
              },
            },
          },
        ],
      },
    ];

    expect(pendingApprovalRequests(messages)).toEqual([]);
  });

  it("lists nothing for a turn with nothing parked", () => {
    const messages: EveMessage[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolCallId: "call-1",
            toolName: "capture_memory",
            state: "output-available",
            input: {},
            output: {},
          },
        ],
      },
    ];

    expect(pendingApprovalRequests(messages)).toEqual([]);
  });
});
