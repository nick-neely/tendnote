import { redisStorage } from "@better-auth/redis-storage";
import { createTendnoteAuth } from "@tendnote/auth";
import { getDb } from "@tendnote/db/client";
import * as schema from "@tendnote/db/schema";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getAgentRedis } from "./redis";

function createAgentAuth() {
  return createTendnoteAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    secondaryStorage: redisStorage({
      client: getAgentRedis(),
      keyPrefix: "tendnote:better-auth:",
    }),
  });
}

let auth: ReturnType<typeof createAgentAuth> | undefined;

/** Better Auth session reader for Eve's independently deployed Vercel service. */
export function getAgentAuth() {
  auth ??= createAgentAuth();
  return auth;
}
