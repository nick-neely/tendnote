import type { AssertionHandle, EveEvalAssertions } from "eve/evals";
import { describe, expect, it } from "vitest";
import { isDraftRevisionReplyCanonical } from "../evals/behavior/draft-revision-assertions";
import { isUnfiledActionReplyCanonical } from "../evals/behavior/general-action-area-filing.eval";
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

describe("draft revision reply contract", () => {
  it("accepts only the canonical unapproved confirmation", () => {
    expect(
      isDraftRevisionReplyCanonical(
        "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft.",
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

  it("rejects punctuation substitutions for the unfiled Action contract", () => {
    expect(isUnfiledActionReplyCanonical("Added the Action unfiled; no Area was assigned!")).toBe(
      false,
    );
    expect(isUnfiledActionReplyCanonical("Added the Action unfiled; no Area was assignedX")).toBe(
      false,
    );
  });
});

function recordedVerdict(events: readonly unknown[]): boolean {
  const { scope, recorded } = recordingScope(events);
  usedNoSubagents(scope);
  return recorded[0]?.passed ?? false;
}
