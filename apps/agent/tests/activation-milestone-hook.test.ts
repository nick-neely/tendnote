import { beforeEach, describe, expect, it, vi } from "vitest";

/** `defineState` needs an eve ALS scope; a plain slot stands in for it. */
const stateSlots = new Map<string, unknown>();
vi.mock("eve/context", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    defineState: <T>(name: string, initial: () => T) => ({
      get: () => (stateSlots.has(name) ? (stateSlots.get(name) as T) : initial()),
      update: (fn: (current: T) => T) => {
        const current = stateSlots.has(name) ? (stateSlots.get(name) as T) : initial();
        stateSlots.set(name, fn(current));
      },
    }),
  };
});

import {
  createActivationMilestoneHook,
  isGroundingResult,
} from "../agent/hooks/activation-milestones";

type Handlers = NonNullable<ReturnType<typeof createActivationMilestoneHook>["events"]>;

const WEB_CHAT_PRINCIPAL = {
  principalId: "user-1",
  principalType: "user",
  authenticator: "tendnote",
  attributes: { channel: "eve" },
};

function context(overrides?: { principal?: unknown; parent?: unknown }) {
  const principal = overrides?.principal === undefined ? WEB_CHAT_PRINCIPAL : overrides.principal;
  return {
    session: {
      id: "wrun_1",
      auth: { current: principal, initiator: principal },
      parent: overrides?.parent,
      turn: { id: "turn-1", sequence: 0 },
    },
  } as never;
}

function personContext(output: unknown, overrides: Record<string, unknown> = {}) {
  return {
    kind: "tool-result",
    toolName: "get_person_context",
    callId: "call-1",
    output,
    ...overrides,
  };
}

const GROUNDED = personContext({
  found: true,
  approvedMemories: [{ id: "memory-1" }],
  sourceRecords: [],
});

function actionResult(result: unknown, turnId = "turn-1") {
  return {
    data: { result, status: "completed", sequence: 0, stepIndex: 0, turnId },
  } as never;
}

function turnCompleted(turnId = "turn-1") {
  return { data: { sequence: 0, turnId } } as never;
}

function build() {
  const record = vi.fn(async () => undefined);
  const warn = vi.fn();
  const events = createActivationMilestoneHook({ record, warn }).events as Handlers;
  return { record, warn, events };
}

beforeEach(() => {
  stateSlots.clear();
});

describe("grounded answer detection", () => {
  it("counts the owner's confirmed Memories or logged notes about a person", () => {
    expect(isGroundingResult(GROUNDED)).toBe(true);
    expect(
      isGroundingResult(
        personContext({ found: true, approvedMemories: [], sourceRecords: [{ id: "note-1" }] }),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "a person with nothing recorded",
      personContext({ found: true, approvedMemories: [], sourceRecords: [] }),
    ],
    ["an unknown person", personContext({ found: false })],
    ["a failed read", personContext({ found: true, approvedMemories: [{}] }, { isError: true })],
    [
      "another tool",
      personContext({ found: true, approvedMemories: [{}] }, { toolName: "web_fetch" }),
    ],
    ["a subagent result", { kind: "subagent-result", output: {} }],
  ])("does not count %s", (_case, result) => {
    expect(isGroundingResult(result)).toBe(false);
  });
});

describe("first grounded Eve answer milestone", () => {
  it("is recorded when a web-chat turn completes after a grounded read", async () => {
    const { events, record } = build();

    await events["action.result"]?.(actionResult(GROUNDED), context());
    await events["turn.completed"]?.(turnCompleted(), context());

    expect(record).toHaveBeenCalledWith({
      userId: "user-1",
      milestone: "first_grounded_eve_answer",
    });
  });

  it("is not recorded for a turn without a grounded read", async () => {
    const { events, record } = build();

    await events["action.result"]?.(actionResult(GROUNDED, "turn-1"), context());
    await events["turn.completed"]?.(turnCompleted("turn-2"), context());
    await events["turn.completed"]?.(turnCompleted("turn-1"), context());
    await events["turn.completed"]?.(turnCompleted("turn-1"), context());

    expect(record).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a subagent", { parent: { sessionId: "parent" } }],
    [
      "a Discord session",
      { principal: { ...WEB_CHAT_PRINCIPAL, attributes: { channel: "discord" } } },
    ],
    ["an unauthenticated session", { principal: null }],
  ])("is never recorded from %s", async (_case, overrides) => {
    const { events, record } = build();

    await events["action.result"]?.(actionResult(GROUNDED), context(overrides));
    await events["turn.completed"]?.(turnCompleted(), context(overrides));

    expect(record).not.toHaveBeenCalled();
  });

  it("never fails the turn when recording fails", async () => {
    const { events, record, warn } = build();
    record.mockRejectedValueOnce(new Error("database unavailable"));

    await events["action.result"]?.(actionResult(GROUNDED), context());
    await expect(events["turn.completed"]?.(turnCompleted(), context())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
