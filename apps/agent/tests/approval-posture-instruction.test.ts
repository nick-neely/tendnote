import { beforeEach, describe, expect, it, vi } from "vitest";
import approvalPostureInstructions from "../agent/instructions/approval-posture";
import { setApprovalPolicyDependencies } from "../agent/lib/approval/dependencies";
import {
  ASK_APPROVAL_POSTURE,
  approvalPostureInstruction,
  TAINTED_APPROVAL_POSTURE,
  TRUSTED_APPROVAL_POSTURE,
} from "../agent/lib/approval-posture";

type Resolver = (event: unknown, ctx: unknown) => Promise<{ content?: string } | null>;

const resolve = (approvalPostureInstructions as unknown as { events: Record<string, Resolver> })
  .events["turn.started"];

/**
 * The paragraph this context resolves to, or `null`.
 *
 * `defineInstructions` brands its return with a symbol so eve can tell an
 * authored instruction from an arbitrary object, so the assertion reads the one
 * field this file is about rather than the whole branded value.
 */
async function posture(ctx: unknown): Promise<string | null> {
  const resolved = await resolve?.({}, ctx);
  return resolved?.content ?? null;
}

/** The dynamic resolve context an authenticated web-chat turn arrives with. */
function resolveContext(
  options: {
    messages?: readonly unknown[];
    principalId?: string | null;
    /** What the channel's own AuthFn stamped. `eve` is web chat. */
    channel?: string;
    principalType?: string;
    subagent?: boolean;
  } = {},
) {
  const principal =
    options.principalId === null
      ? null
      : {
          attributes: { channel: options.channel ?? "eve" },
          authenticator: "better-auth",
          principalId: options.principalId ?? "user-1",
          principalType: options.principalType ?? "user",
        };

  return {
    channel: { kind: "http" },
    messages: options.messages ?? [],
    session: {
      id: "session-1",
      auth: { current: principal, initiator: principal },
      ...(options.subagent === true ? { parent: { sessionId: "parent-1", turnId: "t-1" } } : {}),
    },
  };
}

/** An assistant turn that read a web page. */
const WEB_FETCH_HISTORY = [
  {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "c1", toolName: "web_fetch", input: {} }],
  },
];

describe("approvalPostureInstruction: exactly one paragraph per posture", () => {
  it.each([
    ["ask, untainted", { mode: "ask" as const, tainted: false }, ASK_APPROVAL_POSTURE],
    ["trusted, untainted", { mode: "trusted" as const, tainted: false }, TRUSTED_APPROVAL_POSTURE],
    ["ask, tainted", { mode: "ask" as const, tainted: true }, TAINTED_APPROVAL_POSTURE],
    ["trusted, tainted", { mode: "trusted" as const, tainted: true }, TAINTED_APPROVAL_POSTURE],
  ])("%s", (_name, input, expected) => {
    // Taint wins over the mode, because a Tainted Conversation asks again in
    // both of them.
    expect(approvalPostureInstruction(input)).toBe(expected);
  });

  it("says nothing about which tool is in which tier", () => {
    // The model never learns the map: knowing which named tool runs without a
    // click is what would let it pick one to get a write past a review it expected.
    for (const paragraph of [
      ASK_APPROVAL_POSTURE,
      TRUSTED_APPROVAL_POSTURE,
      TAINTED_APPROVAL_POSTURE,
    ]) {
      expect(paragraph).not.toMatch(/capture_|create_|archive_|web_fetch|web_search/);
      expect(paragraph).not.toMatch(/reversiblePrivateWrite|tier|approval mode/i);
    }
  });

  it("never coaches the user to type an answer", () => {
    for (const paragraph of [
      ASK_APPROVAL_POSTURE,
      TRUSTED_APPROVAL_POSTURE,
      TAINTED_APPROVAL_POSTURE,
    ]) {
      expect(paragraph).not.toMatch(/type ["“]?approve/i);
    }
  });
});

describe("the turn.started instruction resolves the posture from trusted signals only", () => {
  const readApprovalMode = vi.fn(async () => "ask" as "ask" | "trusted");

  beforeEach(() => {
    readApprovalMode.mockReset().mockResolvedValue("ask");
    setApprovalPolicyDependencies({ readApprovalMode });
  });

  it("emits the ask paragraph for an ask-mode owner", async () => {
    await expect(posture(resolveContext())).resolves.toBe(ASK_APPROVAL_POSTURE);
    expect(readApprovalMode).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("emits the trusted paragraph for a trusted-mode owner", async () => {
    readApprovalMode.mockResolvedValue("trusted");

    await expect(posture(resolveContext())).resolves.toBe(TRUSTED_APPROVAL_POSTURE);
  });

  it("emits the tainted paragraph once the history has read a web page", async () => {
    readApprovalMode.mockResolvedValue("trusted");

    await expect(posture(resolveContext({ messages: WEB_FETCH_HISTORY }))).resolves.toBe(
      TAINTED_APPROVAL_POSTURE,
    );
  });

  it("falls back to ask when the mode cannot be read", async () => {
    // The same direction the policy fails in: an unreadable mode parks, so
    // telling the model that saves pause is the truth.
    readApprovalMode.mockRejectedValue(new Error("connection refused"));

    await expect(posture(resolveContext())).resolves.toBe(ASK_APPROVAL_POSTURE);
  });

  it.each([
    ["an unauthenticated turn", { principalId: null }],
    ["a blank principal", { principalId: "  " }],
    ["a subagent turn", { subagent: true }],
    // Not web chat: a Discord capture turn carries a real signed-in user, and the
    // policy still denies every gated call it makes. A paragraph telling it that
    // reversible private saves run immediately would describe a posture that
    // does not exist there, which is why this shares the policy's own caller
    // check rather than the looser orientation one.
    ["a signed-in user on another channel", { channel: "discord" }],
    ["a user principal with no channel marker", { channel: "" }],
    ["Eve's own runtime principal", { principalType: "runtime", principalId: "eve:app" }],
  ])("says nothing on %s", async (_name, options) => {
    // No caller the policy would park for means no Approval Mode to state.
    await expect(posture(resolveContext(options))).resolves.toBeNull();
    expect(readApprovalMode).not.toHaveBeenCalled();
  });
});
