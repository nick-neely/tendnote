/**
 * Discord's OAuth2 token revocation endpoint (RFC 7009). Client-authenticated,
 * accepts the token in an `application/x-www-form-urlencoded` body.
 */
export const DISCORD_OAUTH_REVOKE_URL = "https://discord.com/api/oauth2/token/revoke";

export type RevokeDiscordTokenInput = {
  /** The linked account's decrypted Discord access token to revoke. */
  accessToken: string;
  /** App's Discord client id, used to authenticate the revoke request. */
  clientId: string;
  /** App's Discord client secret, used to authenticate the revoke request. */
  clientSecret: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
};

/**
 * Best-effort revoke a Discord access token provider-side (RFC 7009), mirroring the
 * Google disconnect posture (ADR-0080/0081). Client-authenticated with the app's
 * Discord client id/secret via HTTP Basic auth so the secret stays out of the body;
 * the token itself travels in the form body (never the URL) so it can't leak into
 * request logs. Resolves with whether Discord acknowledged the revocation (2xx); a
 * non-2xx response resolves `false` rather than throwing. Network/other fetch errors
 * still reject and are handled best-effort by the caller.
 */
export async function revokeDiscordToken(input: RevokeDiscordTokenInput): Promise<boolean> {
  const doFetch = input.fetchImpl ?? fetch;
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
  const response = await doFetch(DISCORD_OAUTH_REVOKE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      token: input.accessToken,
      token_type_hint: "access_token",
    }).toString(),
  });
  return response.ok;
}

export type RevokeDiscordTokenBestEffortDeps = {
  /** App Discord credentials; absent ids/secrets mean no revoke can be authenticated. */
  env: { clientId?: string; clientSecret?: string };
  /** Reads the linked account's decrypted access token, ONLY for this revoke call. */
  getAccessToken: () => Promise<string | null | undefined>;
  /** Injectable for tests; defaults to `console.warn`. */
  warn?: (message: string, ...rest: unknown[]) => void;
};

/**
 * The best-effort revoke used by the Discord disconnect path (#176), mirroring the
 * Google disconnect. Owns every failure mode — missing client credentials, no token
 * to revoke, a non-2xx response, and network/other errors all resolve `false` and are
 * logged here — so the pure disconnect layer stays log-free while the revoke outcome
 * still flows into the audit reason. Never throws.
 */
export async function revokeDiscordTokenBestEffort(
  deps: RevokeDiscordTokenBestEffortDeps,
): Promise<boolean> {
  const warn = deps.warn ?? console.warn;
  const { clientId, clientSecret } = deps.env;
  if (!clientId || !clientSecret) {
    return false; // no client credentials to authenticate a revoke
  }

  try {
    const accessToken = await deps.getAccessToken();
    if (!accessToken) {
      return false; // nothing to revoke
    }

    const revoked = await revokeDiscordToken({ accessToken, clientId, clientSecret });
    if (!revoked) {
      warn("[tendnote] Discord token revoke returned a non-success response");
    }
    return revoked;
  } catch (error) {
    warn("[tendnote] Discord token revoke on disconnect failed", error);
    return false;
  }
}
