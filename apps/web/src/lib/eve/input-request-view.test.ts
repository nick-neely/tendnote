import type { EveMessageInputRequest, EveMessagePart } from "eve/react";
import { describe, expect, it } from "vitest";
import {
  approvalInputFields,
  toInputRequestView,
  toInputResolutionView,
} from "./input-request-view";

/**
 * eve 0.47.7's own approval request, verbatim from `extractApprovalRequests`: a fixed
 * placeholder prompt, `confirmation` display, no freeform, and unstyled `approve` /
 * `cancel` options. Nothing here describes the action - that lives on the part.
 */
const FETCH_REQUEST: EveMessageInputRequest = {
  kind: "tool-approval",
  requestId: "req-1",
  prompt: "Approve tool call: web_fetch",
  display: "confirmation",
  allowFreeform: false,
  options: [
    { id: "approve", label: "Approve" },
    { id: "cancel", label: "Cancel" },
  ],
};

function parkedPart(
  overrides: { request?: EveMessageInputRequest; toolName?: string } = {},
): EveMessagePart {
  return {
    type: "dynamic-tool",
    toolCallId: "call-1",
    toolName: overrides.toolName ?? "web_fetch",
    state: "approval-requested",
    approval: { id: (overrides.request ?? FETCH_REQUEST).requestId },
    input: { url: "https://example.com/articles/tea-ceremony" },
    toolMetadata: {
      eve: {
        kind: "tool-call",
        name: overrides.toolName ?? "web_fetch",
        inputRequest: overrides.request ?? FETCH_REQUEST,
      },
    },
  };
}

describe("toInputRequestView (a tool call parked on the owner)", () => {
  /**
   * The whole substance of an approval. eve's prompt names only the tool and the
   * browser's copy of the request carries no input, so the frozen call on the part is
   * the only account of what is about to happen.
   */
  it("carries the frozen tool input, which is the only description of the action", () => {
    expect(toInputRequestView(parkedPart())?.fields).toEqual([
      { key: "url", value: "https://example.com/articles/tea-ceremony", block: false },
    ]);
  });

  /**
   * The subject lookup is described from this value, and the card's fields are
   * rendered from it. They have to be the *same* value: a summary described from one
   * input beside arguments taken from another is the mismatch the gate exists to stop.
   */
  it("carries the unflattened input too, so a server lookup describes what is shown", () => {
    const view = toInputRequestView(parkedPart());

    expect(view?.input).toEqual({ url: "https://example.com/articles/tea-ceremony" });
    expect(view?.fields[0]?.value).toBe("https://example.com/articles/tea-ceremony");
  });

  it("carries Eve's own option ids and labels, so nothing is hardcoded client-side", () => {
    expect(toInputRequestView(parkedPart())?.options).toEqual([
      { id: "approve", label: "Approve", description: null, style: "default" },
      { id: "cancel", label: "Cancel", description: null, style: "default" },
    ]);
  });

  it("keys the answer on the request id and the card on the tool call id", () => {
    const view = toInputRequestView(parkedPart());

    expect(view?.requestId).toBe("req-1");
    expect(view?.toolCallId).toBe("call-1");
    expect(view?.toolName).toBe("web_fetch");
    expect(view?.kind).toBe("tool-approval");
  });

  it("defaults a question with choices to a select and a bare one to a text answer", () => {
    const withChoices = toInputRequestView(
      parkedPart({
        toolName: "ask_question",
        request: {
          kind: "question",
          requestId: "req-2",
          prompt: "Which Mara?",
          options: [
            { id: "a", label: "Mara Ellis" },
            { id: "b", label: "Mara Okonkwo" },
          ],
        },
      }),
    );
    const bare = toInputRequestView(
      parkedPart({
        toolName: "ask_question",
        request: { kind: "question", requestId: "req-3", prompt: "What should I call them?" },
      }),
    );

    expect(withChoices?.display).toBe("select");
    expect(withChoices?.allowFreeform).toBe(false);
    expect(bare?.display).toBe("text");
    expect(bare?.options).toEqual([]);
  });

  it("ignores a call that is not parked", () => {
    const running: EveMessagePart = {
      type: "dynamic-tool",
      toolCallId: "call-1",
      toolName: "web_fetch",
      state: "input-available",
      input: {},
    };

    expect(toInputRequestView(running)).toBeNull();
    expect(toInputRequestView({ type: "text", text: "hi", state: "done" })).toBeNull();
  });

  it("ignores a question with no prompt, which asks nothing", () => {
    const promptless = parkedPart({
      toolName: "ask_question",
      request: { kind: "question", requestId: "req-9", prompt: "   " },
    });

    expect(toInputRequestView(promptless)).toBeNull();
  });

  /**
   * An approval never depends on the prompt, so a blank one changes nothing: the
   * frozen call still says exactly what would happen.
   */
  it("still renders an approval whose prompt says nothing", () => {
    const view = toInputRequestView(
      parkedPart({ request: { kind: "tool-approval", requestId: "req-1", prompt: "" } }),
    );

    expect(view?.fields).toHaveLength(1);
  });
});

describe("toInputResolutionView (how a parked request ended)", () => {
  it("reads the owner's own answer back while Eve has not settled the call yet", () => {
    // The client's optimistic projection: the response is on the wire and eve has
    // returned no verdict, so the outcome stays `answered` rather than claiming one.
    const answered: EveMessagePart = {
      type: "dynamic-tool",
      toolCallId: "call-1",
      toolName: "web_fetch",
      state: "approval-responded",
      approval: { id: "req-1" },
      input: {},
      toolMetadata: {
        eve: {
          kind: "tool-call",
          name: "web_fetch",
          inputRequest: FETCH_REQUEST,
          inputResponse: { requestId: "req-1", optionId: "cancel" },
        },
      },
    };

    expect(toInputResolutionView(answered)).toMatchObject({
      outcome: "answered",
      answerLabel: "Cancel",
      requestId: "req-1",
      toolCallId: "call-1",
    });
  });

  it("reports Eve's settled approval", () => {
    const approved: EveMessagePart = {
      type: "dynamic-tool",
      toolCallId: "call-1",
      toolName: "web_fetch",
      state: "approval-responded",
      approval: { id: "req-1", approved: true },
      input: {},
      toolMetadata: { eve: { kind: "tool-call", name: "web_fetch", inputRequest: FETCH_REQUEST } },
    };

    expect(toInputResolutionView(approved)?.outcome).toBe("approved");
  });

  it("reports a decline with Eve's own reason", () => {
    const denied: EveMessagePart = {
      type: "dynamic-tool",
      toolCallId: "call-1",
      toolName: "web_fetch",
      state: "output-denied",
      approval: { id: "req-1", approved: false, reason: "Tool execution was cancelled." },
      input: {},
      toolMetadata: { eve: { kind: "tool-call", name: "web_fetch", inputRequest: FETCH_REQUEST } },
    };

    expect(toInputResolutionView(denied)).toMatchObject({
      outcome: "declined",
      detail: "Tool execution was cancelled.",
    });
  });

  it("reports a call the owner approved that then failed", () => {
    const failed: EveMessagePart = {
      type: "dynamic-tool",
      toolCallId: "call-1",
      toolName: "web_fetch",
      state: "output-error",
      approval: { id: "req-1", approved: true },
      errorText: "The page took too long to answer.",
      input: {},
      toolMetadata: { eve: { kind: "tool-call", name: "web_fetch", inputRequest: FETCH_REQUEST } },
    };

    expect(toInputResolutionView(failed)).toMatchObject({
      outcome: "failed",
      detail: "The page took too long to answer.",
    });
  });

  /**
   * The scope line. A tool that failed or was refused without ever being shown to the
   * owner keeps its existing silent treatment - the model gets the reason and says so
   * in its own words. Projecting those here would turn every ordinary tool error into
   * a card and, worse, would report "Declined" for a decision nobody made.
   */
  it("says nothing about a call the owner was never asked about", () => {
    const denied: EveMessagePart = {
      type: "dynamic-tool",
      toolCallId: "call-2",
      toolName: "capture_memory",
      state: "output-denied",
      approval: { id: "call-2", approved: false, reason: "Not available." },
      input: {},
    };
    const failed: EveMessagePart = {
      type: "dynamic-tool",
      toolCallId: "call-3",
      toolName: "search_people",
      state: "output-error",
      errorText: "boom",
      input: {},
    };

    expect(toInputResolutionView(denied)).toBeNull();
    expect(toInputResolutionView(failed)).toBeNull();
  });

  it("says nothing about an approval the framework granted on its own", () => {
    const automatic: EveMessagePart = {
      type: "dynamic-tool",
      toolCallId: "call-1",
      toolName: "web_fetch",
      state: "approval-responded",
      approval: { id: "req-1", approved: true, isAutomatic: true },
      input: {},
      toolMetadata: { eve: { kind: "tool-call", name: "web_fetch", inputRequest: FETCH_REQUEST } },
    };

    expect(toInputResolutionView(automatic)).toBeNull();
  });

  it("says nothing about a call that is still parked or still running", () => {
    expect(toInputResolutionView(parkedPart())).toBeNull();
  });
});

describe("approvalInputFields (the frozen call, flattened for a human)", () => {
  it("keys each argument by the tool's own parameter name", () => {
    expect(
      approvalInputFields({ personId: "person_1", content: "Allergic to shellfish." }),
    ).toEqual([
      { key: "personId", value: "person_1", block: false },
      { key: "content", value: "Allergic to shellfish.", block: false },
    ]);
  });

  it("keeps a nested argument's shape rather than dropping it from the decision", () => {
    const [field] = approvalInputFields({ sourceRefs: [{ kind: "memory", id: "m1" }] });

    expect(field?.key).toBe("sourceRefs");
    expect(field?.block).toBe(true);
    expect(field?.value).toContain('"kind": "memory"');
  });

  it("shows a bare argument that is not an object at all", () => {
    expect(approvalInputFields("just a string")).toEqual([
      { key: null, value: "just a string", block: false },
    ]);
    expect(approvalInputFields(undefined)).toEqual([]);
  });

  it("marks a long or multi-line value as its own block, so the card can fold it", () => {
    const [long] = approvalInputFields({ body: "y".repeat(400) });
    const [lines] = approvalInputFields({ body: "one\ntwo" });

    expect(long?.block).toBe(true);
    expect(lines?.block).toBe(true);
  });

  it("caps a runaway value instead of pouring it into the transcript", () => {
    const [field] = approvalInputFields({ body: "z".repeat(9000) });

    expect(field?.value.length).toBeLessThan(2100);
    expect(field?.value.endsWith("…")).toBe(true);
  });

  it("keeps a value it cannot serialize, because it is still a fact about the call", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(approvalInputFields({ payload: cyclic })).toEqual([
      { key: "payload", value: "(unreadable value)", block: false },
    ]);
  });
});
