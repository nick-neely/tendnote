import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { admittedOwnerOrNull } from "@/lib/access/current-access";
import { getBetterAuthSecret } from "@/lib/auth/server";
import { discordEnvFromProcess } from "@/lib/auth/social";
import { syncDiscordGuildCommands } from "@/lib/integrations/discord-commands";
import {
  DISCORD_INSTALL_STATE_COOKIE,
  evaluateDiscordInstallCallback,
} from "@/lib/integrations/discord-install";
import { recordOwnerDiscordInstall } from "@/lib/integrations/discord-install-server";

type DiscordInstallCallbackOutcome = {
  installed?: string;
  error?: string;
  warning?: string;
};

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

  const outcome: DiscordInstallCallbackOutcome =
    result.status === "ok" ? await recordInstall(result) : { error: result.reason };

  const redirectUrl = new URL("/account/discord", request.url);
  for (const [key, value] of Object.entries(outcome)) {
    if (value) {
      redirectUrl.searchParams.set(key, value);
    }
  }
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
}): Promise<DiscordInstallCallbackOutcome> {
  const recorded = await recordOwnerDiscordInstall({
    ownerUserId: result.ownerUserId,
    guildId: result.guildId,
    permissions: result.permissions,
    scopes: result.scopes,
  });
  if (recorded.status !== "recorded") {
    return { error: "missing_identity" };
  }

  const discord = discordEnvFromProcess();
  if (!discord.clientId || !discord.clientSecret) {
    return { installed: result.guildId, warning: "command_registration_failed" };
  }

  const commandSync = await syncDiscordGuildCommands({
    clientId: discord.clientId,
    clientSecret: discord.clientSecret,
    guildId: result.guildId,
  });
  if (commandSync.status === "failed") {
    console.error("[tendnote] Discord command registration failed", {
      guildId: result.guildId,
      stage: commandSync.stage,
      httpStatus: commandSync.httpStatus,
    });
    return { installed: result.guildId, warning: "command_registration_failed" };
  }

  return { installed: result.guildId };
}
