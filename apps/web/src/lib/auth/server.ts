// fallow-ignore-file circular-dependencies -- The account-create after-link hook
// dynamically imports the integrations boundary (reconcileDiscordAfterLink) to break
// the *runtime* init cycle (#174, ADR-0138); the boundary re-enters admission checks
// in current-access, which needs getAuth from here. Fallow counts the deliberate
// lazy `await import()` edges as a static cycle even though they are runtime-safe.
import { redisStorage } from "@better-auth/redis-storage";
import { createTendnoteAuth, resolveBetterAuthSecret } from "@tendnote/auth";
import { getDb } from "@tendnote/db/client";
import { ensureAccessProfile } from "@tendnote/db/queries/access-profiles";
import { assertHouseholdAccountDeletionAllowed } from "@tendnote/db/queries/households";
import * as schema from "@tendnote/db/schema";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getRedis } from "@/lib/cache/redis";
import {
  discordEnvFromProcess,
  discordSocialProvider,
  githubEnvFromProcess,
  githubSocialProvider,
  googleEnvFromProcess,
  googleSocialProvider,
  socialAccountLinking,
} from "./social";

/**
 * Resolve the Better Auth signing secret. Required in production; falls back to a
 * shared local-dev secret otherwise. Exported so flows that must sign with the
 * same key (e.g. the Discord install `state`, #173) reuse one resolver rather than
 * duplicating the fallback magic string.
 */
export function getBetterAuthSecret() {
  return resolveBetterAuthSecret();
}

function createSocialProviders() {
  const github = githubSocialProvider(githubEnvFromProcess());
  // Google backs Phase 2C Calendar account linking (ADR-0071). Wired only when
  // credentials are configured; Better Auth owns its OAuth token custody/refresh.
  const google = googleSocialProvider(googleEnvFromProcess());
  // Discord backs feature-specific identity linking (ADR-0138).
  // Wired only when credentials are configured; Better Auth owns its OAuth token
  // custody. Callback URL: <BETTER_AUTH_URL>/api/auth/callback/discord.
  const discord = discordSocialProvider(discordEnvFromProcess());
  return {
    ...(github ? { github } : {}),
    ...(google ? { google } : {}),
    ...(discord ? { discord } : {}),
  };
}

function createDatabaseHooks() {
  return {
    user: {
      create: {
        after: async (user: { id: string }) => {
          // Every new signup gets a durable pending profile. Production admission
          // is resolved by the explicit hosted/self-hosted policy; local demo
          // access uses its separate loopback-only owner path.
          await ensureAccessProfile({ userId: user.id });
        },
      },
    },
    account: {
      create: {
        after: async (
          account: Parameters<
            Awaited<
              typeof import("@/lib/integrations/provider-connections")
            >["reconcileDiscordAfterLink"]
          >[0],
        ) => {
          // Reconcile a freshly linked Discord account into its identity mapping +
          // Provider Connection right away (#174, ADR-0138), rather than waiting for
          // the next /account load. Imported lazily to keep this module free of the
          // server-only integrations boundary (and its `next/headers` deps) at load.
          // The whole body — the dynamic import included — is wrapped so a rejection
          // never propagates through createWithHooks into the OAuth callback: an
          // import failure would otherwise fail the redirect. reconcileDiscordAfterLink
          // ignores non-Discord links, gates on admission, and self-swallows its own
          // failures; the /account page-load reconcile stays as the self-healing
          // backstop.
          try {
            const { reconcileDiscordAfterLink } = await import(
              "@/lib/integrations/provider-connections"
            );
            await reconcileDiscordAfterLink(account);
          } catch (error) {
            console.error("[tendnote] Discord after-link hook failed to run", error);
          }
        },
      },
    },
  };
}

function createAuth() {
  const socialProviders = createSocialProviders();

  return createTendnoteAuth({
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
    // GitHub (sign-in), Google (Phase 2C Calendar linking), and Discord (identity
    // linking) — each wired only when its credentials are configured.
    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
    account: {
      // Encrypt OAuth access/refresh tokens at rest (keyed off BETTER_AUTH_SECRET)
      // so Calendar token custody never lands in the DB in plaintext (ADR-0071).
      encryptOAuthTokens: true,
      // linkSocial connects Google Calendar / Discord to the already signed-in
      // Tendnote user rather than creating a parallel account.
      accountLinking: socialAccountLinking(),
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (deletingUser) => {
          await assertHouseholdAccountDeletionAllowed({ userId: deletingUser.id });
        },
      },
    },
    databaseHooks: createDatabaseHooks(),
    secondaryStorage: redisStorage({
      client: getRedis(),
      keyPrefix: "tendnote:better-auth:",
    }),
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  auth ??= createAuth();
  return auth;
}
