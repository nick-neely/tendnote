import { createTendnoteAuth } from "@tendnote/auth";
import { getDb } from "@tendnote/db/client";
import * as schema from "@tendnote/db/schema";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { serializeSignedCookie } from "better-call";
import { instantBetterAuthSecret, instantCanonicalUrl, instantRedisUrl } from "./rig";

/**
 * Mints a real Better Auth session for a fixture owner.
 *
 * The rig deliberately does not sign in through the browser. The matrix measures
 * navigation and mutation inside an already-admitted session, and driving the
 * sign-in form would add a network-shaped precondition to every spec without
 * proving anything the auth suite does not already prove. What it does instead
 * is mint the session through Better Auth itself — same shared options, same
 * signing secret, same secondary storage — so what the browser presents is a
 * genuine production session token, not a bypass.
 *
 * The session lives in Redis, not Postgres: `apps/web/src/lib/auth/server.ts`
 * configures `secondaryStorage` without `storeSessionInDatabase`, so inserting a
 * `session` row would authenticate nothing. This mints through
 * `internalAdapter.createSession` for that reason, exactly as the local
 * demo-session bridge does.
 */

type MintedSession = {
  cookieName: string;
  cookieValue: string;
};

/**
 * The auth environment is passed explicitly rather than read from the ambient
 * process: the fixture must produce the *production* cookie name
 * (`__Secure-`prefixed) and signature that the measured server will verify,
 * whatever `NODE_ENV` the test runner happens to have.
 */
const authEnvironment = {
  NODE_ENV: "production",
  BETTER_AUTH_URL: instantCanonicalUrl(),
  BETTER_AUTH_SECRET: instantBetterAuthSecret(),
} as const;

let cachedAuth: ReturnType<typeof createTendnoteAuth> | undefined;

async function getRigAuth() {
  if (cachedAuth) return cachedAuth;

  const { default: Redis } = await import("ioredis");
  const { redisStorage } = await import("@better-auth/redis-storage");

  cachedAuth = createTendnoteAuth(
    {
      database: drizzleAdapter(getDb(), { provider: "pg", schema }),
      emailAndPassword: { enabled: true },
      secondaryStorage: redisStorage({
        client: new Redis(instantRedisUrl(), { maxRetriesPerRequest: 2 }),
        keyPrefix: "tendnote:better-auth:",
      }),
    },
    authEnvironment,
  );

  return cachedAuth;
}

/** Extract the stored cookie value from a `Set-Cookie` header. */
function cookieValueFrom(setCookie: string): string {
  const firstPair = setCookie.split(";", 1)[0] ?? "";
  const separator = firstPair.indexOf("=");
  return firstPair.slice(separator + 1);
}

export async function mintOwnerSession(userId: string): Promise<MintedSession> {
  const auth = await getRigAuth();
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);

  if (!session) {
    throw new Error(`Better Auth refused to create a session for fixture owner ${userId}.`);
  }

  const setCookie = await serializeSignedCookie(
    context.authCookies.sessionToken.name,
    session.token,
    context.secret,
    {
      ...context.authCookies.sessionToken.attributes,
      maxAge: context.sessionConfig.expiresIn,
    },
  );

  return {
    cookieName: context.authCookies.sessionToken.name,
    cookieValue: cookieValueFrom(setCookie),
  };
}
