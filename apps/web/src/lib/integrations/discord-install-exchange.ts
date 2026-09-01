import "server-only";

import { DISCORD_BOT_INSTALL_SCOPES, isDiscordSnowflake } from "./discord-install";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Provider-authoritative confirmation of a bot install, obtained by exchanging the
 * authorization `code` (never a query-string `guild_id`) for a token whose response
 * carries the real `guild`. See Discord's "Extended bot authorization access token
 * response" (topics/oauth2): a bot-authorization code exchange returns a `guild`
 * object plus the granted `scope`.
 */
export type DiscordInstallExchangeResult =
  | { status: "confirmed"; guildId: string; scopes: string[]; permissions: string | null }
  | {
      status: "failed";
      stage: "token_request" | "token_response" | "missing_guild" | "invalid_guild";
      httpStatus?: number;
    };

type DiscordInstallExchangeInput = {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
};

/**
 * Exchange a Discord bot-install authorization `code` for the authoritative guild
 * install. The `code` is single-use at Discord, so a replayed callback carrying a
 * stale `code` fails here (`token_request`) and writes no row — the exchange itself
 * is the server-side single-use consumption of the install.
 *
 * `redirect_uri` must be byte-identical to the authorization request's (see
 * `resolveDiscordInstallRedirectUri`) or Discord rejects the exchange. Uses HTTP
 * Basic client auth + form body, mirroring the client-credentials call in
 * `discord-commands.ts`.
 */
export async function exchangeDiscordInstallCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<DiscordInstallExchangeResult> {
  const request: DiscordInstallExchangeInput = {
    ...input,
    fetchImpl: input.fetchImpl ?? fetch,
    timeoutMs: input.timeoutMs ?? DISCORD_REQUEST_TIMEOUT_MS,
  };

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: request.code,
    redirect_uri: request.redirectUri,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await request.fetchImpl(`${DISCORD_API_BASE_URL}/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${request.clientId}:${request.clientSecret}`).toString(
          "base64",
        )}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
      cache: "no-store",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch {
    return { status: "failed", stage: "token_request" };
  }

  if (!tokenResponse.ok) {
    return { status: "failed", stage: "token_request", httpStatus: tokenResponse.status };
  }

  let payload: {
    guild?: { id?: unknown } | null;
    scope?: unknown;
  };
  try {
    payload = (await tokenResponse.json()) as typeof payload;
  } catch {
    return { status: "failed", stage: "token_response" };
  }

  // The guild is the provider-authoritative install target — the whole point of
  // the exchange. Its absence means this code did not authorize a guild install.
  const guildId = typeof payload.guild?.id === "string" ? payload.guild.id.trim() : "";
  if (!guildId) {
    return { status: "failed", stage: "missing_guild" };
  }
  if (!isDiscordSnowflake(guildId)) {
    return { status: "failed", stage: "invalid_guild" };
  }

  return {
    status: "confirmed",
    guildId,
    scopes: parseGrantedScopes(payload.scope),
    // Discord's install token response does not surface the bot's granted
    // permission bitfield here, and the query-string `permissions` is forgeable, so
    // no permission value is asserted from the callback. The install was requested
    // with DISCORD_BOT_INSTALL_PERMISSIONS; effective permissions live in the guild.
    permissions: null,
  };
}

/** Parse the space-delimited granted `scope` string, defaulting to the requested scopes. */
function parseGrantedScopes(scope: unknown): string[] {
  if (typeof scope !== "string") {
    return [...DISCORD_BOT_INSTALL_SCOPES];
  }
  const granted = scope.split(/\s+/).filter((entry) => entry.length > 0);
  return granted.length > 0 ? granted : [...DISCORD_BOT_INSTALL_SCOPES];
}
