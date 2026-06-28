import { redisStorage } from "@better-auth/redis-storage";
import { getDb } from "@tendnote/db/client";
import { ensureAccessProfile } from "@tendnote/db/queries/access-profiles";
import * as schema from "@tendnote/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getRedis } from "@/lib/cache/redis";
import { githubEnvFromProcess, githubSocialProvider } from "./social";

function getBetterAuthSecret() {
  if (process.env.BETTER_AUTH_SECRET) {
    return process.env.BETTER_AUTH_SECRET;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production.");
  }

  return "tendnote-local-dev-secret-change-before-production";
}

function createAuth() {
  const github = githubSocialProvider(githubEnvFromProcess());

  return betterAuth({
    appName: "Tendnote",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: getBetterAuthSecret(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        // Tendnote does not send email as a product feature in Phase 2A, so the
        // reset link is surfaced server-side for an operator to deliver during
        // private beta. A real transactional email provider plugs in here later.
        console.info(`[tendnote] Password reset link for ${user.email}: ${url}`);
      },
    },
    // GitHub is the only Phase 2A social provider, and only when configured.
    ...(github ? { socialProviders: { github } } : {}),
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Every new signup gets a durable access profile: the first user
            // bootstraps as the initial allowed owner, later users start pending
            // until Private Beta Access is granted (ADR-0067).
            await ensureAccessProfile({ userId: user.id });
          },
        },
      },
    },
    secondaryStorage: redisStorage({
      client: getRedis(),
      keyPrefix: "tendnote:better-auth:",
    }),
    trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3000"],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  auth ??= createAuth();
  return auth;
}
