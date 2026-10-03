import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasSavedAPerson } = vi.hoisted(() => ({ hasSavedAPerson: vi.fn() }));
vi.mock("@tendnote/db/queries/first-run", () => ({ hasSavedAPerson }));

import firstCaptureInstructions from "../agent/instructions/first-capture";
import { FIRST_CAPTURE_STEER } from "../agent/lib/first-capture-steer";

type Resolver = (event: unknown, ctx: unknown) => Promise<{ content?: string } | null>;

const resolve = (firstCaptureInstructions as unknown as { events: Record<string, Resolver> })
  .events["turn.started"];

async function steer(ctx: unknown): Promise<string | null> {
  const resolved = await resolve?.({}, ctx);
  return resolved?.content ?? null;
}

/** An authenticated turn; `eve` is web chat, `discord` a capture with nobody to steer. */
function turn(options: { channel?: string; subagent?: boolean } = {}) {
  const principal = {
    attributes: { channel: options.channel ?? "eve" },
    authenticator: "better-auth",
    principalId: "user-1",
    principalType: "user",
  };
  return {
    channel: { kind: "http" },
    messages: [],
    session: {
      id: "session-1",
      auth: { current: principal, initiator: principal },
      ...(options.subagent ? { parent: { sessionId: "parent-1", turnId: "t-1" } } : {}),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasSavedAPerson.mockResolvedValue(false);
});

describe("first-capture steer", () => {
  it("steers a web-chat owner who has saved nobody yet", async () => {
    await expect(steer(turn())).resolves.toBe(FIRST_CAPTURE_STEER);
    expect(hasSavedAPerson).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("stops once the owner has saved a person", async () => {
    hasSavedAPerson.mockResolvedValue(true);
    await expect(steer(turn())).resolves.toBeNull();
  });

  it("says nothing when the read fails", async () => {
    hasSavedAPerson.mockRejectedValue(new Error("db down"));
    await expect(steer(turn())).resolves.toBeNull();
  });

  it("says nothing to a subagent or a session nobody is watching", async () => {
    await expect(steer(turn({ subagent: true }))).resolves.toBeNull();
    await expect(steer(turn({ channel: "discord" }))).resolves.toBeNull();
    await expect(steer({ session: { auth: { current: null } } })).resolves.toBeNull();
    expect(hasSavedAPerson).not.toHaveBeenCalled();
  });

  it("keeps the capture and steers exactly once, never refusing it", () => {
    expect(FIRST_CAPTURE_STEER).toContain("General Action");
    expect(FIRST_CAPTURE_STEER).toMatch(/never refuse/);
    expect(FIRST_CAPTURE_STEER).toMatch(/exactly one sentence/);
    expect(FIRST_CAPTURE_STEER).toMatch(/at most once/);
  });
});
