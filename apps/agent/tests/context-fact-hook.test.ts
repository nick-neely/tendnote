import type { SessionAuthContext } from "eve/context";
import { describe, expect, it, vi } from "vitest";
import { createAmbientContextFactHook } from "../agent/hooks/ambient-context-facts";
import type { enqueueAndPublishContextFactExtractionJob } from "../agent/lib/background-jobs/context-fact-extraction-queue";
import {
  EVE_CONTEXT_FACT_CHANNEL_MARKER,
  resolveAmbientContextFactOwner,
} from "../agent/lib/context-fact-eligibility";

const auth = (overrides: Partial<SessionAuthContext> = {}): SessionAuthContext => ({
  attributes: { channel: EVE_CONTEXT_FACT_CHANNEL_MARKER },
  authenticator: "better-auth",
  principalId: "user-1",
  principalType: "user",
  ...overrides,
});

describe("ambient Context Fact eligibility", () => {
  it("requires an authenticated root Eve user and current bounded message", () => {
    expect(
      resolveAmbientContextFactOwner({
        auth: auth(),
        message: "I work in Chicago.",
      }),
    ).toBe("user-1");
    expect(
      resolveAmbientContextFactOwner({ auth: null, message: "I work in Chicago." }),
    ).toBeNull();
    expect(
      resolveAmbientContextFactOwner({
        auth: auth({ principalType: "service" }),
        message: "I work in Chicago.",
      }),
    ).toBeNull();
    expect(
      resolveAmbientContextFactOwner({
        auth: auth({ attributes: { channel: "discord" } }),
        message: "I work in Chicago.",
      }),
    ).toBeNull();
    expect(
      resolveAmbientContextFactOwner({
        auth: auth(),
        parent: {
          callId: "call-1",
          rootSessionId: "root",
          sessionId: "child",
          turn: { id: "turn", sequence: 0 },
        },
        message: "I work in Chicago.",
      }),
    ).toBeNull();
  });
});

describe("ambient Context Fact Eve hook", () => {
  const hookContext = {
    session: {
      id: "session-1",
      auth: { current: auth(), initiator: null },
      turn: { id: "turn-1", sequence: 0 },
    },
  };
  const messageEvent = {
    type: "message.received" as const,
    data: {
      message: "I work in Chicago.",
      sequence: 1,
      turnId: "turn-1",
    },
  };

  it("enqueues only the accepted root Eve message and keys replay by turn", async () => {
    const enqueue = vi.fn().mockResolvedValue({});
    const hook = createAmbientContextFactHook(
      enqueue as unknown as typeof enqueueAndPublishContextFactExtractionJob,
    );
    const handler = hook.events?.["message.received"] as unknown as (
      event: typeof messageEvent,
      context: typeof hookContext,
    ) => void | Promise<void>;

    await handler(messageEvent, hookContext);
    expect(enqueue).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      message: "I work in Chicago.",
      idempotencyKey: "eve:session-1:turn-1",
    });
  });

  it("swallows queue failure so the response path cannot fail", async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const hook = createAmbientContextFactHook(
      enqueue as unknown as typeof enqueueAndPublishContextFactExtractionJob,
    );
    const handler = hook.events?.["message.received"] as unknown as (
      event: typeof messageEvent,
      context: typeof hookContext,
    ) => void | Promise<void>;

    expect(() => handler(messageEvent, hookContext)).not.toThrow();
  });

  it("does not enqueue assistant, provider, or shared-channel events", async () => {
    const enqueue = vi.fn().mockResolvedValue({});
    const hook = createAmbientContextFactHook(
      enqueue as unknown as typeof enqueueAndPublishContextFactExtractionJob,
    );
    const handler = hook.events?.["message.received"] as unknown as (
      event: typeof messageEvent,
      context: typeof hookContext,
    ) => void | Promise<void>;

    await handler(messageEvent, {
      ...hookContext,
      session: {
        ...hookContext.session,
        auth: { current: auth({ attributes: { channel: "discord" } }), initiator: null },
      },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
