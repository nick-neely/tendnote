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

/** One lazy Redis connection per independently deployed Eve service process. */
export function getAgentRedis(): Redis {
  redis ??= new Redis(resolveAgentRedisUrl(), {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  return redis;
}
