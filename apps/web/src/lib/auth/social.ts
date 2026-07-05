import { DISCORD_IDENTIFY_SCOPE, GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from "@tendnote/domain";

/**
 * Social/OAuth provider configuration for Better Auth. GitHub (Phase 2A) backs
 * sign-in; Google backs feature-specific account linking for Calendar, Gmail, and
 * Contacts (ADR-0067, ADR-0071, ADR-0090, ADR-0107). Each provider is optional and only wired
 * when both credentials are present. Pure so it can be unit tested.
 */
export type GithubEnv = { clientId?: string; clientSecret?: string };

export function isGithubConfigured(env: GithubEnv): boolean {
  return Boolean(env.clientId && env.clientSecret);
}

export function githubSocialProvider(
  env: GithubEnv,
): { clientId: string; clientSecret: string } | undefined {
  return env.clientId && env.clientSecret
    ? { clientId: env.clientId, clientSecret: env.clientSecret }
    : undefined;
}

/** Read GitHub OAuth credentials from the server environment. */
export function githubEnvFromProcess(): GithubEnv {
  return {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}

export type GoogleEnv = { clientId?: string; clientSecret?: string };

/**
 * Better Auth Google provider config (Phase 2C, ADR-0071). `accessType: "offline"`
 * plus `prompt: "select_account consent"` ensure Google issues a refresh token so
 * Better Auth can refresh access without re-prompting. The base provider scope is
 * Calendar event-read; Gmail draft access and Contacts read access are added later
 * through linkSocial incremental consent. Token custody and refresh stay inside
 * Better Auth; Tendnote never stores the tokens.
 */
export type GoogleSocialProvider = {
  clientId: string;
  clientSecret: string;
  accessType: "offline";
  prompt: "select_account consent";
  scope: string[];
};

export function isGoogleConfigured(env: GoogleEnv): boolean {
  return Boolean(env.clientId && env.clientSecret);
}

export function googleSocialProvider(env: GoogleEnv): GoogleSocialProvider | undefined {
  return env.clientId && env.clientSecret
    ? {
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        accessType: "offline",
        prompt: "select_account consent",
        scope: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE],
      }
    : undefined;
}

/** Read Google OAuth credentials from the server environment. */
export function googleEnvFromProcess(): GoogleEnv {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

export type DiscordEnv = { clientId?: string; clientSecret?: string };

/**
 * Better Auth Discord provider config (ADR-0138). Backs feature-specific Discord
 * identity linking, not sign-in. Better Auth's Discord provider requests
 * `["identify", "email"]` by default AND appends any configured `scope`, so a
 * `scope` override alone cannot drop `email`. We set `disableDefaultScope` to clear
 * that default and request `identify` only — Tendnote never wants Discord email as
 * the stable identity, and phone-only Discord accounts have none, so linking must
 * not depend on it. Better Auth performs the OAuth redirect and owns token custody;
 * Tendnote persists only the non-secret Discord user id + username as owner-scoped
 * identity/connection state.
 */
export type DiscordSocialProvider = {
  clientId: string;
  clientSecret: string;
  /** Clears Better Auth's default `["identify", "email"]` so only `scope` is requested. */
  disableDefaultScope: true;
  scope: string[];
};

export function isDiscordConfigured(env: DiscordEnv): boolean {
  return Boolean(env.clientId && env.clientSecret);
}

export function discordSocialProvider(env: DiscordEnv): DiscordSocialProvider | undefined {
  return env.clientId && env.clientSecret
    ? {
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        disableDefaultScope: true,
        scope: [DISCORD_IDENTIFY_SCOPE],
      }
    : undefined;
}

/** Read Discord OAuth credentials from the server environment. */
export function discordEnvFromProcess(): DiscordEnv {
  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
  };
}
