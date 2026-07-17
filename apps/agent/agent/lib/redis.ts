import Redis from "ioredis";

let redis: Redis | undefined;

/** One lazy Redis connection per independently deployed Eve service process. */
export function getAgentRedis(): Redis {
  redis ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:56379", {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  return redis;
}
