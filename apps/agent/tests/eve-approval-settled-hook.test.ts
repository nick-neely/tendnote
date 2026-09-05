import type { settleEveApprovalDecision } from "@tendnote/db/queries/eve-approval-decisions";
import { describe, expect, it, vi } from "vitest";
import { createEveApprovalSettledHook } from "../agent/hooks/eve-approval-settled";
import { APPROVAL_REQUEST_KIND } from "../agent/lib/approval";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

function hookHandlers(settle: typeof settleEveApprovalDecision) {
  const events = (createEveApprovalSettledHook(settle) as { events: Record<string, Handler> })
    .events;
  return {
    requested: events["input.requested"],
    settled: events["approval.settled"],
  };
}

/** One `input.requested` batch entry for a parked tool call. */
function approvalRequest(requestId: string, callId: string, kind = APPROVAL_REQUEST_KIND) {
  return {
    action: { callId, input: {}, kind: "tool-call", toolName: "capture_memory" },
    kind,
    prompt: "Approve tool call: capture_memory",
    requestId,
  };
}

const ctx = { session: { id: "session-1" } };

function settleMock() {
  return vi.fn(async () => ({ settled: true })) as unknown as typeof settleEveApprovalDecision & {
    mock: { calls: unknown[][] };
  };
}

describe("the approval settled hook maps an owner's answer onto the decision record", () => {
  it.each([
    ["approved", "allowed"],
    ["cancelled", "cancelled"],
  ])("records %s as %s", async (outcome, settledOutcome) => {
    const settle = settleMock();
    const { requested, settled } = hookHandlers(settle);

    await requested?.({ data: { requests: [approvalRequest("req-1", "call-9")] } }, ctx);
    await settled?.({ data: { requestId: "req-1", outcome } }, ctx);

    expect(settle).toHaveBeenCalledWith({
      sessionId: "session-1",
      callId: "call-9",
      settledOutcome,
    });
  });

  it("settles nothing for a request it never saw", async () => {
    // A restart between the request and the answer loses the pairing. The row
    // stays unsettled, which is an honest gap rather than a guessed call id.
    const settle = settleMock();
    const { settled } = hookHandlers(settle);

    await settled?.({ data: { requestId: "req-unknown", outcome: "approved" } }, ctx);

    expect(settle).not.toHaveBeenCalled();
  });

  it("ignores an input request that is not a tool approval", async () => {
    // eve also raises `question` and `session-limit` requests. Neither has a
    // decision row behind it.
    const settle = settleMock();
    const { requested, settled } = hookHandlers(settle);

    await requested?.(
      { data: { requests: [approvalRequest("req-1", "call-9", "question")] } },
      ctx,
    );
    await settled?.({ data: { requestId: "req-1", outcome: "approved" } }, ctx);

    expect(settle).not.toHaveBeenCalled();
  });

  it("settles each request once", async () => {
    // `approval.settled` can be replayed. The query is already idempotent; this
    // keeps the hook from re-asking it in the first place.
    const settle = settleMock();
    const { requested, settled } = hookHandlers(settle);

    await requested?.({ data: { requests: [approvalRequest("req-1", "call-9")] } }, ctx);
    await settled?.({ data: { requestId: "req-1", outcome: "approved" } }, ctx);
    await settled?.({ data: { requestId: "req-1", outcome: "cancelled" } }, ctx);

    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("keeps each hook instance's own pairings", async () => {
    const first = settleMock();
    const second = settleMock();
    const one = hookHandlers(first);
    const two = hookHandlers(second);

    await one.requested?.({ data: { requests: [approvalRequest("req-1", "call-9")] } }, ctx);
    await two.settled?.({ data: { requestId: "req-1", outcome: "approved" } }, ctx);

    expect(second).not.toHaveBeenCalled();
  });

  it("swallows a failed write, because a hook never fails a turn", async () => {
    const settle = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof settleEveApprovalDecision;
    const { requested, settled } = hookHandlers(settle);

    await requested?.({ data: { requests: [approvalRequest("req-1", "call-9")] } }, ctx);

    await expect(
      settled?.({ data: { requestId: "req-1", outcome: "approved" } }, ctx),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["no requests array", { data: {} }],
    ["a request with no id", { data: { requests: [approvalRequest("", "call-9")] } }],
    ["a request with no call id", { data: { requests: [approvalRequest("req-1", "")] } }],
  ])("ignores %s without throwing", (_name, event) => {
    const settle = settleMock();
    const { requested } = hookHandlers(settle);

    expect(() => requested?.(event, ctx)).not.toThrow();
    expect(settle).not.toHaveBeenCalled();
  });

  it("bounds what one process remembers", async () => {
    // An owner answers or abandons a card in the same session. The cap is here
    // so a long-lived process cannot grow a map of abandoned requests forever;
    // evicting the oldest is right because it is the least likely to be answered.
    const settle = settleMock();
    const { requested, settled } = hookHandlers(settle);

    for (let index = 0; index < 201; index += 1) {
      await requested?.(
        { data: { requests: [approvalRequest(`req-${index}`, `call-${index}`)] } },
        ctx,
      );
    }

    await settled?.({ data: { requestId: "req-0", outcome: "approved" } }, ctx);
    expect(settle).not.toHaveBeenCalled();

    await settled?.({ data: { requestId: "req-200", outcome: "approved" } }, ctx);
    expect(settle).toHaveBeenCalledWith({
      sessionId: "session-1",
      callId: "call-200",
      settledOutcome: "allowed",
    });
  });
});
