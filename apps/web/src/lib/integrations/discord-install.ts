import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Discord bot-install OAuth flow (issue #173, builds on #168/ADR-0139).
 *
 * This is a DIFFERENT OAuth flow from the Better Auth `identify` account link
 * (ADR-0138): it authorizes the shared Tendnote bot into a guild with the
 * `bot`/`applications.commands` scopes. Discord's authorization-code grant returns
 * an authorization `code`; the callback exchanges it server-to-server for the
 * provider-authoritative install (`exchangeDiscordInstallCode`), whose token
 * response carries the real `guild`. The redirect's `guild_id`/`permissions` query
 * params are browser-controlled and NOT trusted — trusting them let an admitted
 * user mint a valid state and then claim an arbitrary guild, turning the shared bot
 * into a confused deputy. The installing owner comes only from the signed-in
 * Tendnote session, bound into a signed `state` and re-checked on the callback, so
 * an unauthenticated or mismatched-state return writes no row.
 *
 * Pure (no next/DB/Better Auth imports) so the URL construction, state signing,
 * and fail-closed callback rules are unit-testable; the thin route glue that reads
 * the session, sets/reads the cookie, and persists lives in the route handlers.
 */

/** Discord's OAuth2 authorization endpoint. */
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";

/**
 * Scopes requested for the bot install. `bot` adds the shared application to the
 * guild; `applications.commands` lets it register the `/capture` slash command.
 * Deliberately NOT `identify`/`email`/`guilds`/message-content — the owner's
 * Discord identity is linked separately (ADR-0138), and the install records only
 * non-secret guild metadata.
 */
export const DISCORD_BOT_INSTALL_SCOPES = ["bot", "applications.commands"] as const;

/**
 * Bot permission bitfield requested at install: VIEW_CHANNEL (1024) +
 * SEND_MESSAGES (2048) + EMBED_LINKS (16384) = 19456. Just enough for the Private
 * Capture Channel to receive interactions and post concise proactive nudges — no
 * moderation, admin, or unrelated permissions (docs §2 Bot permissions).
 */
export const DISCORD_BOT_INSTALL_PERMISSIONS = "19456";

/** How long a signed install `state` stays valid (10 minutes). */
export const DISCORD_INSTALL_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** Cookie carrying the install `state` nonce, for double-submit CSRF binding. */
export const DISCORD_INSTALL_STATE_COOKIE = "tendnote_discord_install_state";

/**
 * A Discord snowflake id: 17–20 digits. Guild ids, channel ids, and user ids are
 * all snowflakes, so this is the shared shape check applied to any id that reaches
 * the store — including the guild id derived from the provider-authoritative token
 * exchange (never a raw query param).
 */
export function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value.trim());
}

/**
 * A Discord channel id (snowflake): 17–20 digits. Validated on both the client
 * (skip the round-trip on obviously bad input) and the server (reject a malformed
 * or whitespace-only id before it reaches the store).
 */
export function isDiscordChannelId(value: string): boolean {
  return isDiscordSnowflake(value);
}

/**
 * The canonical Discord install redirect URI. It MUST be byte-identical between
 * the authorization request (install route) and the token exchange (callback):
 * Discord rejects a token exchange whose `redirect_uri` differs from the one the
 * `code` was issued for. Built from the canonical public base (`BETTER_AUTH_URL`)
 * so it stays stable behind proxies, falling back to the request origin locally.
 */
export function resolveDiscordInstallRedirectUri(requestUrl: string): string {
  const baseUrl = process.env.BETTER_AUTH_URL ?? new URL(requestUrl).origin;
  return new URL("/api/integrations/discord/install/callback", baseUrl).toString();
}

/**
 * Build the Discord bot-install authorization URL. `integration_type=0`
 * (GUILD_INSTALL) is required because the scope contains `applications.commands`.
 * `state` is the signed, session-bound value validated on the callback. The
 * requested permissions are fixed to {@link DISCORD_BOT_INSTALL_PERMISSIONS}.
 */
export function buildDiscordInstallAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", DISCORD_BOT_INSTALL_SCOPES.join(" "));
  url.searchParams.set("permissions", DISCORD_BOT_INSTALL_PERMISSIONS);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** The session-bound payload signed into the install `state`. */
export type DiscordInstallStatePayload = {
  /** The signed-in Tendnote owner who initiated the install. */
  ownerUserId: string;
  /** Random per-flow nonce, mirrored into the state cookie for double-submit. */
  nonce: string;
  /** Epoch millis the state was issued, for freshness enforcement. */
  issuedAt: number;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Sign the session-bound state. The owner id, nonce, and issued-at are HMAC'd with
 * the server secret so the callback can trust that the returning owner and nonce
 * are the ones this server issued — a client can neither forge nor tamper it.
 */
export function signDiscordInstallState(
  payload: DiscordInstallStatePayload,
  secret: string,
): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${signBody(body, secret)}`;
}

/**
 * Verify and parse a signed install state, or `null` when it is missing,
 * malformed, or its signature does not match. Constant-time signature comparison
 * avoids leaking validity through timing.
 */
export function parseDiscordInstallState(
  token: string | null | undefined,
  secret: string,
): DiscordInstallStatePayload | null {
  if (!token) {
    return null;
  }
  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = signBody(body, secret);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }
  const json = base64UrlDecode(body);
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as Partial<DiscordInstallStatePayload>;
    if (
      typeof parsed.ownerUserId === "string" &&
      parsed.ownerUserId.length > 0 &&
      typeof parsed.nonce === "string" &&
      parsed.nonce.length > 0 &&
      typeof parsed.issuedAt === "number" &&
      Number.isFinite(parsed.issuedAt)
    ) {
      return { ownerUserId: parsed.ownerUserId, nonce: parsed.nonce, issuedAt: parsed.issuedAt };
    }
  } catch {
    return null;
  }
  return null;
}

/** Why an install callback was rejected without writing a row. */
export type DiscordInstallRejectReason =
  | "discord_error"
  | "unauthenticated"
  | "invalid_state"
  | "owner_mismatch"
  | "missing_code";

/**
 * Outcome of the fail-closed pre-exchange checks. `authorized` means the returning
 * caller owns a valid, fresh, single-use state and Discord handed back an
 * authorization `code` — but NOT yet that any guild install is real. The guild is
 * only established by exchanging that `code` server-to-server with Discord (see
 * `exchangeDiscordInstallCode`); nothing here is trusted from the raw query string
 * except the opaque `code`, which is worthless without the client secret.
 */
export type DiscordInstallAuthorization =
  | { status: "authorized"; ownerUserId: string; code: string; nonce: string }
  | { status: "reject"; reason: DiscordInstallRejectReason };

/**
 * Fail-closed evaluation of the bot-install callback's session/state layer. Returns
 * `authorized` only when every check passes: Discord returned no error, a session
 * owner exists, the signed state is valid and fresh, its nonce matches the
 * double-submit cookie, its owner matches the session owner, and Discord returned
 * an authorization `code`. Any failure rejects with a reason and writes no row.
 *
 * Deliberately does NOT read `guild_id`/`permissions` from the query string: those
 * are browser-controlled and forgeable, so trusting them let an admitted user mint
 * a valid state and then claim an arbitrary guild. The guild now comes only from
 * the provider-authoritative token exchange keyed on this `code`. The installing
 * owner is taken from `sessionOwnerUserId`; the state's owner only has to AGREE.
 */
export function evaluateDiscordInstallCallback(input: {
  sessionOwnerUserId: string | null;
  params: {
    state?: string | null;
    code?: string | null;
    error?: string | null;
  };
  cookieNonce: string | null;
  secret: string;
  now: number;
  maxAgeMs?: number;
}): DiscordInstallAuthorization {
  if (input.params.error) {
    return { status: "reject", reason: "discord_error" };
  }
  if (!input.sessionOwnerUserId) {
    return { status: "reject", reason: "unauthenticated" };
  }

  const payload = parseDiscordInstallState(input.params.state, input.secret);
  if (!payload) {
    return { status: "reject", reason: "invalid_state" };
  }
  if (!input.cookieNonce || payload.nonce !== input.cookieNonce) {
    return { status: "reject", reason: "invalid_state" };
  }
  const maxAgeMs = input.maxAgeMs ?? DISCORD_INSTALL_STATE_MAX_AGE_MS;
  const age = input.now - payload.issuedAt;
  // Reject stale states, and states issued "in the future" beyond the same
  // window. The symmetric `-maxAgeMs` bound tolerates modest clock skew between
  // the issuing and validating request rather than failing closed on a few
  // seconds of drift, while still rejecting a wildly future-dated (forged) issue.
  if (age < -maxAgeMs || age > maxAgeMs) {
    return { status: "reject", reason: "invalid_state" };
  }
  if (payload.ownerUserId !== input.sessionOwnerUserId) {
    return { status: "reject", reason: "owner_mismatch" };
  }
  const code = input.params.code?.trim();
  if (!code) {
    return { status: "reject", reason: "missing_code" };
  }

  return {
    status: "authorized",
    ownerUserId: input.sessionOwnerUserId,
    code,
    nonce: payload.nonce,
  };
}
