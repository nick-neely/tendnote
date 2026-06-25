import Redis from "ioredis";

let redis: Redis | undefined;

export function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:56379", {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }

  return redis;
}
