import Redis from "ioredis";

let redis: Redis | undefined;

export function resolveAgentRedisUrl(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "REDIS_URL">> = process.env,
): string {
  const configured = env.REDIS_URL?.trim();
  if (configured) return configured;

  if (env.NODE_ENV === "production") {
    throw new Error("REDIS_URL is required by the hosted Eve service in production.");
  }

  return "redis://localhost:56379";
}

/**
 * The budget every command on this connection is held to, in milliseconds.
 *
 * Discord closes an interaction that has not been acknowledged within three
 * seconds, and the HITL session store sits directly on that path: the Clarify
 * click has to park a session before the modal can open. ioredis defaults to a
 * 10s connect timeout and no command timeout at all, so a blackholed Redis (a
 * dropped packet rather than a refused connection) would spend the whole window
 * and hand the user a failed interaction with nothing to click. Failing in
 * 1.5s leaves room to answer with the ephemeral "try again" message instead.
 *
 * The same ceiling is safe for the other users of this connection. Rate
 * limiting does INCR plus EXPIRE and Better Auth's secondary storage does GET,
 * SET, and DEL; none of them blocks, scans, or streams, so a command that has
 * not answered in 1.5s is a broken connection rather than slow work.
 */
const AGENT_REDIS_TIMEOUT_MS = 1500;

/** One lazy Redis connection per independently deployed Eve service process. */
export function getAgentRedis(): Redis {
  redis ??= new Redis(resolveAgentRedisUrl(), {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: AGENT_REDIS_TIMEOUT_MS,
    commandTimeout: AGENT_REDIS_TIMEOUT_MS,
  });

  return redis;
}
