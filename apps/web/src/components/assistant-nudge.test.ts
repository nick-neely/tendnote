import { describe, expect, it, vi } from "vitest";
import { sendNudgeToAgent } from "./assistant-nudge";

/**
 * The nudge binding sends the prompt to Eve via `agent.send` — and only that. It
 * performs no mutation and is gated on the agent being ready (#114).
 */
describe("sendNudgeToAgent", () => {
  it("sends the nudge prompt to Eve when the agent is ready", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const started = sendNudgeToAgent({ status: "ready", send }, undefined, "Follow up with Maya");

    expect(started).toBe(true);
    expect(send).toHaveBeenCalledWith({ message: "Follow up with Maya", clientContext: undefined });
  });

  it("includes one-turn person context when scoped", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    sendNudgeToAgent(
      { status: "ready", send },
      { personId: "p1", personName: "Maya" },
      "Follow up with Maya",
    );

    expect(send).toHaveBeenCalledWith({
      message: "Follow up with Maya",
      clientContext: { person: { id: "p1", displayName: "Maya" } },
    });
  });

  it("does nothing when the agent is not ready (no send, no mutation)", () => {
    const send = vi.fn();
    const started = sendNudgeToAgent({ status: "submitted", send }, undefined, "Follow up");

    expect(started).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
