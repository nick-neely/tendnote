import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { admittedOwnerOrNull } from "@/lib/access/current-access";
import { getBetterAuthSecret } from "@/lib/auth/server";
import {
  DISCORD_INSTALL_STATE_COOKIE,
  evaluateDiscordInstallCallback,
} from "@/lib/integrations/discord-install";
import { recordOwnerDiscordInstall } from "@/lib/integrations/discord-install-server";

/**
 * Discord bot-install callback (issue #173). Fail-closed: it records a
 * `discord_installs` row only when the signed-in owner matches the signed,
 * fresh, nonce-bound `state` and Discord returned a guild id. An unauthenticated
 * or mismatched-state return writes nothing and no owner is inferred from the
 * guild. Always clears the one-shot state cookie, then returns to the delivery
 * settings page with an outcome the UI renders.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const [sessionOwnerUserId, cookieStore] = await Promise.all([admittedOwnerOrNull(), cookies()]);
  const result = evaluateDiscordInstallCallback({
    sessionOwnerUserId,
    params: {
      state: params.get("state"),
      guildId: params.get("guild_id"),
      permissions: params.get("permissions"),
      error: params.get("error"),
    },
    cookieNonce: cookieStore.get(DISCORD_INSTALL_STATE_COOKIE)?.value ?? null,
    secret: getBetterAuthSecret(),
    now: Date.now(),
  });

  const outcome =
    result.status === "ok" ? await recordInstall(result) : { param: "error", value: result.reason };

  const redirectUrl = new URL("/account/discord", request.url);
  redirectUrl.searchParams.set(outcome.param, outcome.value);
  const response = NextResponse.redirect(redirectUrl);
  // The state is single-use: clear the nonce cookie regardless of outcome.
  response.cookies.delete({
    name: DISCORD_INSTALL_STATE_COOKIE,
    path: "/api/integrations/discord/install",
  });
  return response;
}

async function recordInstall(result: {
  ownerUserId: string;
  guildId: string;
  permissions: string | null;
  scopes: string[];
}): Promise<{ param: string; value: string }> {
  const recorded = await recordOwnerDiscordInstall({
    ownerUserId: result.ownerUserId,
    guildId: result.guildId,
    permissions: result.permissions,
    scopes: result.scopes,
  });
  return recorded.status === "recorded"
    ? { param: "installed", value: result.guildId }
    : { param: "error", value: "missing_identity" };
}
