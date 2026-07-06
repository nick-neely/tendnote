import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getBetterAuthSecret } from "@/lib/auth/server";
import { discordEnvFromProcess } from "@/lib/auth/social";
import {
  buildDiscordInstallAuthorizeUrl,
  DISCORD_INSTALL_STATE_COOKIE,
  DISCORD_INSTALL_STATE_MAX_AGE_MS,
  signDiscordInstallState,
} from "@/lib/integrations/discord-install";

/**
 * Start the Discord bot-install flow (issue #173). Resolves the admitted owner from
 * the trusted session, mints a signed, session-bound `state` (plus a matching nonce
 * cookie for double-submit CSRF), and redirects to Discord's authorization URL.
 * Only the signed-in owner is ever bound into the state — the callback re-checks it,
 * so an install can never be attributed to anyone but the initiating session.
 */
export async function GET(request: Request): Promise<Response> {
  // Inert when Discord OAuth credentials are not configured server-side. Reading
  // the credentials here both gates the flow and narrows `clientId` to a string.
  const { clientId, clientSecret } = discordEnvFromProcess();
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/account", request.url));
  }

  // Redirects pending / unauthenticated callers via the single owner-resolution
  // path (redirect() works inside a route handler).
  const ownerUserId = await requireAdmittedOwner();

  const nonce = randomUUID();
  const state = signDiscordInstallState(
    { ownerUserId, nonce, issuedAt: Date.now() },
    getBetterAuthSecret(),
  );

  // Redirect_uri must match a URL registered in the Discord Developer Portal. Use
  // the canonical public base (BETTER_AUTH_URL) so it is stable behind proxies.
  const baseUrl = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  const redirectUri = new URL("/api/integrations/discord/install/callback", baseUrl).toString();

  const response = NextResponse.redirect(
    buildDiscordInstallAuthorizeUrl({ clientId, redirectUri, state }),
  );
  response.cookies.set(DISCORD_INSTALL_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/discord/install",
    maxAge: Math.floor(DISCORD_INSTALL_STATE_MAX_AGE_MS / 1000),
  });
  return response;
}
