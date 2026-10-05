import type Redis from "ioredis";

/** Where Better Auth keeps sessions in Redis (`lib/auth/server.ts`). */
const BETTER_AUTH_REDIS_PREFIX = "tendnote:better-auth:";

/** Every key under a prefix, scanned incrementally so Redis is never blocked. */
async function scanKeys(redis: Redis, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return keys;
}

/**
 * Better Auth's whole Redis store as one session cache for a restore: every
 * session, the per-account session lists, and the auth rate-limit counters,
 * which are worth nothing across a restore either.
 */
export function redisSessionCache(redis: Redis) {
  return {
    async deleteAll() {
      const keys = await scanKeys(redis, BETTER_AUTH_REDIS_PREFIX);
      for (let start = 0; start < keys.length; start += 500) {
        await redis.unlink(...keys.slice(start, start + 500));
      }
      return keys.length;
    },
    async count() {
      return (await scanKeys(redis, BETTER_AUTH_REDIS_PREFIX)).length;
    },
  };
}
