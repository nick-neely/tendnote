/**
 * GitHub is the only Phase 2A social provider, and it is optional: sign-in is
 * offered only when both OAuth credentials are present, and hidden otherwise.
 * Google is intentionally not added here — Calendar/Gmail/Contacts will be linked
 * later with feature-specific scopes (ADR-0067). Pure so it can be unit tested.
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
