import {
  createProductRateLimiter,
  createRedisRateLimitStore,
  type ProductRateLimiter,
} from "@tendnote/rate-limit";
import { getAgentRedis } from "./redis";

let limiter: ProductRateLimiter | undefined;

export function getAgentRateLimiter(): ProductRateLimiter {
  limiter ??= createProductRateLimiter(createRedisRateLimitStore(getAgentRedis));
  return limiter;
}
