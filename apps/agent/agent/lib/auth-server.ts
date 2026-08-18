import { redisStorage } from "@better-auth/redis-storage";
import { createTendnoteAuth } from "@tendnote/auth";
import { getDb } from "@tendnote/db/client";
import * as schema from "@tendnote/db/schema";
import { GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from "@tendnote/domain";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getAgentRedis } from "./redis";

/**
 * Eve never runs the Google OAuth UI, but its independently deployed auth
 * runtime must know the same provider lifecycle as web so Better Auth can
 * decrypt and refresh the owner's linked account on a cache miss. Provider
 * credentials stay app/runtime configuration, not database token custody.
 */
function googleSocialProvider() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return undefined;
  }

  return {
    clientId,
    clientSecret,
    accessType: "offline" as const,
    prompt: "select_account consent" as const,
    scope: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE],
  };
}

function createAgentAuth() {
  const google = googleSocialProvider();

  return createTendnoteAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    ...(google ? { socialProviders: { google } } : {}),
    account: {
      // Better Auth owns encrypted OAuth token custody in both deployed
      // runtimes. Its getAccessToken operation decrypts and refreshes; Eve
      // never reads the account columns directly.
      encryptOAuthTokens: true,
    },
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
