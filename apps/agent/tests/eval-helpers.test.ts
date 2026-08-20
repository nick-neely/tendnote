import type { AssertionHandle, EveEvalAssertions } from "eve/evals";
import { describe, expect, it } from "vitest";
import { DRAFT_REVISION_UNSAFE_CLAIMS } from "../evals/behavior/draft-revision-assertions";
import { toolOutputs } from "../evals/expectations";
import {
  firstSubagentIndex,
  firstToolRequestIndex,
  notCalledSubagent,
  usedNoSubagents,
  usedSubagent,
} from "../evals/helpers";

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

describe("draft revision wording guard", () => {
  it("rejects bare externalization, approval, and sent claims", () => {
    const safeReply = new RegExp(
      `^(?![\\s\\S]*(?:${DRAFT_REVISION_UNSAFE_CLAIMS}))[\\s\\S]*$`,
      "i",
    );

    for (const unsafeReply of [
      "I put the revision in a Gmail draft.",
      "Approved.",
      "The message was sent.",
      "The updated note has been sent.",
    ]) {
      expect(unsafeReply).not.toMatch(safeReply);
    }
  });

  it("keeps truthful boundary and prior-approval wording valid", () => {
    const safeReply = new RegExp(
      `^(?![\\s\\S]*(?:${DRAFT_REVISION_UNSAFE_CLAIMS}))[\\s\\S]*$`,
      "i",
    );

    for (const boundaryReply of [
      "The internal Tendnote draft remains unapproved; nothing was approved, exported, or sent, and it is not an external or Gmail draft.",
      "The previously approved draft was edited internally; the prior approval no longer covers this wording.",
      "The draft is not approved and was not sent.",
    ]) {
      expect(boundaryReply).toMatch(safeReply);
    }
  });
});

function recordedVerdict(events: readonly unknown[]): boolean {
  const { scope, recorded } = recordingScope(events);
  usedNoSubagents(scope);
  return recorded[0]?.passed ?? false;
}
