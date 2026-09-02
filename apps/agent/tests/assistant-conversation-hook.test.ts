import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AssistantConversationHookDependencies,
  createAssistantConversationHook,
  normalizeGeneratedTitle,
  resolveAssistantConversationOwner,
} from "../agent/hooks/assistant-conversation";

/**
 * `defineState` needs an active eve ALS scope, which a unit test does not have.
 * The hook's use of it is one carrier for the first turn's assistant text, so it
 * is replaced with a plain in-memory slot: the behavior under test is what the
 * hook writes to the database, not where it parks a string in between.
 */
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

/** The `ai` gateway is never reached in tests; the hook's own dependency seam is used instead. */
vi.mock("ai", () => ({
  gateway: () => ({}),
  generateText: vi.fn(async () => {
    throw new Error("the model must not be called from a unit test");
  }),
}));

type Hook = ReturnType<typeof createAssistantConversationHook>;
type Handlers = NonNullable<Hook["events"]>;

const WEB_CHAT_PRINCIPAL = {
  principalId: "user-1",
  principalType: "user",
  authenticator: "tendnote",
  attributes: { channel: "eve" },
};

function context(overrides?: {
  principal?: unknown;
  parent?: unknown;
  turnSequence?: number;
  sessionId?: string;
}) {
  const principal = overrides?.principal === undefined ? WEB_CHAT_PRINCIPAL : overrides.principal;

  return {
    session: {
      id: overrides?.sessionId ?? "wrun_1",
      auth: { current: principal, initiator: principal },
      parent: overrides?.parent,
      turn: { id: "turn-1", sequence: overrides?.turnSequence ?? 0 },
    },
  } as never;
}

function messageReceived(message: string, turnId = "turn-1") {
  return { data: { message, sequence: 0, turnId } } as never;
}

function messageCompleted(message: string | null, turnId = "turn-1") {
  return {
    data: { message, finishReason: "stop", sequence: 0, stepIndex: 0, turnId },
  } as never;
}

function turnCompleted(turnId = "turn-1") {
  return { data: { sequence: 0, turnId } } as never;
}

function build(overrides: AssistantConversationHookDependencies = {}) {
  const upsert = vi.fn(async () => undefined);
  const touch = vi.fn(async () => ({
    firstMessage: "Remind me what Priya said about the move",
    titleSource: "placeholder" as const,
  }));
  const setTitle = vi.fn(async () => true);
  const generateTitle = vi.fn(
    async (_input: { userMessage: string; assistantReply: string }) => "Priya's move",
  );
  const warn = vi.fn();
  const hook = createAssistantConversationHook({
    upsert,
    touch,
    setTitle,
    generateTitle,
    warn,
    env: { AI_GATEWAY_API_KEY: "test-key" },
    ...overrides,
  });
  const events = hook.events as Handlers;

  return { upsert, touch, setTitle, generateTitle, warn, events };
}

beforeEach(() => {
  stateSlots.clear();
});

describe("assistant conversation eligibility", () => {
  it("accepts a top-level authenticated web chat session", () => {
    expect(
      resolveAssistantConversationOwner({ auth: { current: WEB_CHAT_PRINCIPAL as never } }),
    ).toBe("user-1");
  });

  it("rejects a subagent turn, a non-web channel, and an unauthenticated caller", () => {
    expect(
      resolveAssistantConversationOwner({
        auth: { current: WEB_CHAT_PRINCIPAL as never },
        parent: { sessionId: "wrun_parent" } as never,
      }),
    ).toBeNull();
    expect(
      resolveAssistantConversationOwner({
        auth: {
          current: { ...WEB_CHAT_PRINCIPAL, attributes: { channel: "discord" } } as never,
        },
      }),
    ).toBeNull();
    expect(
      resolveAssistantConversationOwner({
        auth: { current: { ...WEB_CHAT_PRINCIPAL, principalType: "runtime" } as never },
      }),
    ).toBeNull();
    expect(resolveAssistantConversationOwner({ auth: { current: null } })).toBeNull();
  });
});

describe("assistant conversation hook", () => {
  it("records the conversation from the user message the turn carried", async () => {
    const { upsert, events } = build();
    await events["message.received"]?.(messageReceived("  Remind me about Priya  "), context());

    expect(upsert).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      sessionId: "wrun_1",
      firstMessage: "  Remind me about Priya  ",
    });
  });

  it("records nothing for a session that is not a top-level web chat", async () => {
    const { upsert, touch, events } = build();
    const discord = context({
      principal: { ...WEB_CHAT_PRINCIPAL, attributes: { channel: "discord" } },
    });

    await events["message.received"]?.(messageReceived("hello"), discord);
    await events["turn.completed"]?.(turnCompleted(), discord);

    expect(upsert).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it("titles the first turn from the stored message and the assistant reply", async () => {
    const { touch, generateTitle, setTitle, events } = build();

    await events["message.completed"]?.(messageCompleted("Priya is moving in October."), context());
    await events["turn.completed"]?.(turnCompleted(), context());

    expect(touch).toHaveBeenCalledWith({ sessionId: "wrun_1" });
    expect(generateTitle).toHaveBeenCalledWith({
      userMessage: "Remind me what Priya said about the move",
      assistantReply: "Priya is moving in October.",
    });
    expect(setTitle).toHaveBeenCalledWith({
      sessionId: "wrun_1",
      title: "Priya's move",
      source: "model",
    });
  });

  it("titles from the stored message alone when no assistant text was carried", async () => {
    const { generateTitle, setTitle, events } = build();
    await events["turn.completed"]?.(turnCompleted(), context());

    expect(generateTitle).toHaveBeenCalledWith({
      userMessage: "Remind me what Priya said about the move",
      assistantReply: "",
    });
    expect(setTitle).toHaveBeenCalled();
  });

  it("bumps activity but does not re-title a later turn", async () => {
    const { touch, generateTitle, setTitle, events } = build();
    await events["turn.completed"]?.(turnCompleted("turn-2"), context({ turnSequence: 3 }));

    expect(touch).toHaveBeenCalledWith({ sessionId: "wrun_1" });
    expect(generateTitle).not.toHaveBeenCalled();
    expect(setTitle).not.toHaveBeenCalled();
  });

  it("leaves a title the model or the owner already wrote alone", async () => {
    const { generateTitle, setTitle, events } = build({
      touch: vi.fn(async () => ({ firstMessage: "anything", titleSource: "model" as const })),
    });
    await events["turn.completed"]?.(turnCompleted(), context());

    expect(generateTitle).not.toHaveBeenCalled();
    expect(setTitle).not.toHaveBeenCalled();
  });

  it("skips the model call when titling is switched off", async () => {
    const { generateTitle, touch, events } = build({
      env: { AI_GATEWAY_API_KEY: "test-key", TENDNOTE_ASSISTANT_TITLES: "off" },
    });
    await events["turn.completed"]?.(turnCompleted(), context());

    expect(touch).toHaveBeenCalled();
    expect(generateTitle).not.toHaveBeenCalled();
  });

  it("skips the model call when the gateway has no credentials", async () => {
    const { generateTitle, events } = build({ env: {} });
    await events["turn.completed"]?.(turnCompleted(), context());

    expect(generateTitle).not.toHaveBeenCalled();
  });

  it("never throws, whichever dependency fails", async () => {
    const failing = build({
      upsert: vi.fn(async () => {
        throw new Error("db down");
      }),
      touch: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(
      failing.events["message.received"]?.(messageReceived("hello"), context()),
    ).resolves.toBeUndefined();
    await expect(
      failing.events["turn.completed"]?.(turnCompleted(), context()),
    ).resolves.toBeUndefined();
    expect(failing.warn).toHaveBeenCalledTimes(2);

    const failingModel = build({
      generateTitle: vi.fn(async (_input: { userMessage: string; assistantReply: string }) => {
        throw new Error("gateway down");
      }),
    });
    await expect(
      failingModel.events["turn.completed"]?.(turnCompleted(), context()),
    ).resolves.toBeUndefined();
    expect(failingModel.setTitle).not.toHaveBeenCalled();
    expect(failingModel.warn).toHaveBeenCalledTimes(1);
  });

  it("holds only the first turn's reply, and drops it once the title is settled", async () => {
    const { generateTitle, events } = build();

    await events["message.completed"]?.(messageCompleted("first step"), context());
    await events["message.completed"]?.(messageCompleted("second step"), context());
    // A later turn's chunks are not collected at all.
    await events["message.completed"]?.(
      messageCompleted("later turn", "turn-2"),
      context({ turnSequence: 1 }),
    );
    await events["turn.completed"]?.(turnCompleted(), context());

    expect(generateTitle.mock.calls[0]?.[0].assistantReply).toBe("first step\n\nsecond step");

    // The slot is cleared, so a retried turn does not inherit the old reply.
    generateTitle.mockClear();
    await events["turn.completed"]?.(turnCompleted(), context());
    expect(generateTitle.mock.calls[0]?.[0].assistantReply).toBe("");
  });
});

describe("generated title normalization", () => {
  it("strips the decoration a model adds around a name", () => {
    expect(normalizeGeneratedTitle('  "Priya\'s move."  ')).toBe("Priya's move");
    expect(normalizeGeneratedTitle("Weekend plans!")).toBe("Weekend plans");
  });

  it("holds the five-word ceiling even when the model ignores it", () => {
    expect(normalizeGeneratedTitle("one two three four five six seven")).toBe(
      "one two three four five",
    );
  });

  it("answers null for a reply with nothing in it", () => {
    expect(normalizeGeneratedTitle("   ")).toBeNull();
    expect(normalizeGeneratedTitle('"..."')).toBeNull();
  });
});
