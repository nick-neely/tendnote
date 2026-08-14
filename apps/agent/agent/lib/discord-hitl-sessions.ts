import type { DiscordComponentAction } from "./discord-capture";
import { getAgentRedis } from "./redis";

/**
 * A Discord interaction token dies fifteen minutes after the interaction, so a
 * clarification modal opened now can never be submitted after that window. The
 * parked session is worthless past the same horizon, which is why expiry is the
 * store's job (Redis TTL) rather than a sweeper's.
 */
export const DISCORD_HITL_SESSION_TTL_SECONDS = 15 * 60;

const DISCORD_HITL_SESSION_KEY_PREFIX = "tendnote:discord:hitl:";

/**
 * The open-modal state a resume actually needs, and nothing else. The
 * clarification text is never parked: it only exists on the modal submit that
 * resumes the session, and goes straight to the owner's Source Record. No
 * Discord token, signature, or raw payload is ever written here.
 */
export type DiscordHitlSession = {
  ownerUserId: string;
  discordUserId: string;
  sessionId: string;
  action: DiscordComponentAction;
  /** ISO-8601 instant the modal was opened. */
  parkedAt: string;
};

export type DiscordHitlSessionStore = {
  /** Record an opened modal, replacing any earlier session for the same id. */
  park: (session: DiscordHitlSession) => Promise<void>;
  /**
   * Read and consume the parked session, or `null` when it expired, never
   * existed, or belongs to a different owner. Consuming is what makes a modal
   * submit single-use, so a replayed submit cannot capture the same
   * clarification twice.
   */
  take: (input: { ownerUserId: string; sessionId: string }) => Promise<DiscordHitlSession | null>;
};

/**
 * Owner-scoped key. The Discord custom id carries only the session id, so owner
 * scoping has to come from the key: another owner submitting a custom id they
 * copied finds nothing rather than resuming someone else's session.
 */
export function discordHitlSessionKey(input: { ownerUserId: string; sessionId: string }): string {
  return `${DISCORD_HITL_SESSION_KEY_PREFIX}${input.ownerUserId}:${input.sessionId}`;
}

/** The two Redis commands this store needs, so any client shape can back it. */
export type DiscordHitlSessionRedis = {
  set: (key: string, value: string, mode: "EX", ttlSeconds: number) => Promise<unknown>;
  getdel: (key: string) => Promise<string | null>;
};

/**
 * The production store: Redis, so an open modal survives the serverless instance
 * that rendered it being recycled before the user submits. Errors are not caught
 * here: the Discord capture path decides how an unreachable store degrades.
 */
export function createRedisDiscordHitlSessionStore(
  getClient: () => DiscordHitlSessionRedis = getAgentRedis,
): DiscordHitlSessionStore {
  return {
    async park(session) {
      await getClient().set(
        discordHitlSessionKey(session),
        JSON.stringify(session),
        "EX",
        DISCORD_HITL_SESSION_TTL_SECONDS,
      );
    },
    async take(input) {
      const raw = await getClient().getdel(discordHitlSessionKey(input));
      return raw === null ? null : parseDiscordHitlSession(raw);
    },
  };
}

/** In-process store for tests and local runs without Redis. */
export function createInMemoryDiscordHitlSessionStore(): DiscordHitlSessionStore {
  const sessions = new Map<string, DiscordHitlSession>();

  return {
    async park(session) {
      sessions.set(discordHitlSessionKey(session), session);
    },
    async take(input) {
      const key = discordHitlSessionKey(input);
      const session = sessions.get(key) ?? null;
      sessions.delete(key);
      return session;
    },
  };
}

/** A stored value that no longer parses is treated as absent, never as partial state. */
function parseDiscordHitlSession(raw: string): DiscordHitlSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { ownerUserId, discordUserId, sessionId, action, parkedAt } = parsed as Record<
    string,
    unknown
  >;

  if (
    typeof ownerUserId !== "string" ||
    typeof discordUserId !== "string" ||
    typeof sessionId !== "string" ||
    typeof parkedAt !== "string" ||
    (action !== "clarify" && action !== "review")
  ) {
    return null;
  }

  return { ownerUserId, discordUserId, sessionId, action, parkedAt };
}
