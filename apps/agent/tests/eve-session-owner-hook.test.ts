import { describe, expect, it, vi } from "vitest";
import { createEveSessionOwnerHook } from "../agent/hooks/eve-session-owner";

type SessionStartedHandler = NonNullable<
  ReturnType<typeof createEveSessionOwnerHook>["events"]
>["session.started"];

/** Minimal `session.started` context: the hook only reads `session.id` and `session.auth.initiator`. */
function startedContext(
  initiator: {
    principalId: string;
    principalType: string;
  } | null,
) {
  return {
    session: {
      id: "sess-1",
      auth: { current: initiator, initiator },
    },
  } as unknown as Parameters<NonNullable<SessionStartedHandler>>[1];
}

const STARTED_EVENT = {} as unknown as Parameters<NonNullable<SessionStartedHandler>>[0];

async function runHook(
  bind: (input: { sessionId: string; ownerUserId: string }) => Promise<void>,
  initiator: { principalId: string; principalType: string } | null,
) {
  const handler = createEveSessionOwnerHook(bind).events?.["session.started"];
  await handler?.(STARTED_EVENT, startedContext(initiator));
}

describe("eve session owner hook", () => {
  it("persists the initiator as the session owner for a human session", async () => {
    const bind = vi.fn().mockResolvedValue(undefined);
    await runHook(bind, { principalId: "user-123", principalType: "user" });

    expect(bind).toHaveBeenCalledWith({ sessionId: "sess-1", ownerUserId: "user-123" });
  });

  it("does not bind a non-user initiator (scheduled/system/subagent session)", async () => {
    const bind = vi.fn().mockResolvedValue(undefined);
    await runHook(bind, { principalId: "svc", principalType: "service" });
    await runHook(bind, { principalId: "anon", principalType: "anonymous" });

    expect(bind).not.toHaveBeenCalled();
  });

  it("does not bind when the session has no initiator", async () => {
    const bind = vi.fn().mockResolvedValue(undefined);
    await runHook(bind, null);

    expect(bind).not.toHaveBeenCalled();
  });

  it("swallows a persistence failure so it never fails the durable turn", async () => {
    const bind = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(
      runHook(bind, { principalId: "user-123", principalType: "user" }),
    ).resolves.toBeUndefined();
  });
});
