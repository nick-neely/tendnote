import { describe, expect, it, vi } from "vitest";
import {
  createRedisDiscordHitlSessionStore,
  DISCORD_HITL_SESSION_TTL_SECONDS,
  type DiscordHitlSession,
  discordHitlSessionKey,
} from "../agent/lib/discord-hitl-sessions";

const session: DiscordHitlSession = {
  ownerUserId: "owner-1",
  discordUserId: "discord-1",
  sessionId: "session-1",
  action: "clarify",
  parkedAt: "2026-07-02T00:00:00.000Z",
};

/** A Redis double holding raw strings, so serialization is exercised for real. */
function fakeRedis(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    set: vi.fn(async (key: string, value: string, _mode: "EX", _ttlSeconds: number) => {
      values.set(key, value);
      return "OK";
    }),
    getdel: vi.fn(async (key: string) => {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    }),
  };
}

describe("durable Discord HITL sessions", () => {
  it("parks under an owner-scoped key with the modal's own expiry", async () => {
    const redis = fakeRedis();
    await createRedisDiscordHitlSessionStore(() => redis).park(session);

    expect(redis.set).toHaveBeenCalledWith(
      "tendnote:discord:hitl:owner-1:session-1",
      JSON.stringify(session),
      "EX",
      DISCORD_HITL_SESSION_TTL_SECONDS,
    );
    // Only what a resume needs: no Discord token, signature, or payload, and no
    // clarification text (that arrives with the submit).
    expect(Object.keys(JSON.parse(redis.values.get(discordHitlSessionKey(session)) ?? ""))).toEqual(
      ["ownerUserId", "discordUserId", "sessionId", "action", "parkedAt"],
    );
  });

  it("takes a session once, and finds nothing for another owner", async () => {
    const redis = fakeRedis();
    const store = createRedisDiscordHitlSessionStore(() => redis);
    await store.park(session);

    await expect(
      store.take({ ownerUserId: "owner-2", sessionId: "session-1" }),
    ).resolves.toBeNull();
    await expect(store.take({ ownerUserId: "owner-1", sessionId: "session-1" })).resolves.toEqual(
      session,
    );
    await expect(
      store.take({ ownerUserId: "owner-1", sessionId: "session-1" }),
    ).resolves.toBeNull();
  });

  it("treats an expired or unreadable value as no session at all", async () => {
    const redis = fakeRedis({
      "tendnote:discord:hitl:owner-1:torn": "{not json",
      "tendnote:discord:hitl:owner-1:partial": JSON.stringify({ ownerUserId: "owner-1" }),
    });
    const store = createRedisDiscordHitlSessionStore(() => redis);

    // Expiry is Redis's job, so a gone key is simply absent.
    await expect(store.take({ ownerUserId: "owner-1", sessionId: "expired" })).resolves.toBeNull();
    await expect(store.take({ ownerUserId: "owner-1", sessionId: "torn" })).resolves.toBeNull();
    await expect(store.take({ ownerUserId: "owner-1", sessionId: "partial" })).resolves.toBeNull();
  });
});
