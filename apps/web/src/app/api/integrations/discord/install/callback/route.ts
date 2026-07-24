import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { admittedOwnerOrNull } from "@/lib/access/current-access";
import { getBetterAuthSecret } from "@/lib/auth/server";
import { discordEnvFromProcess } from "@/lib/auth/social";
import {
  accountMutationScopes,
  updateAccountMutationScopes,
} from "@/lib/cache/account-mutation-scopes";
import { syncDiscordGuildCommands } from "@/lib/integrations/discord-commands";
import {
  DISCORD_INSTALL_STATE_COOKIE,
  type DiscordInstallCallbackResult,
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

  const outcome = await resolveInstallOutcome(result);
  const response = NextResponse.redirect(buildInstallRedirectUrl(request.url, outcome));
  // The state is single-use: clear the nonce cookie regardless of outcome.
  response.cookies.delete({
    name: DISCORD_INSTALL_STATE_COOKIE,
    path: "/api/integrations/discord/install",
  });
  return response;
}

async function resolveInstallOutcome(
  result: DiscordInstallCallbackResult,
): Promise<DiscordInstallCallbackOutcome> {
  return result.status === "ok" ? recordInstall(result) : { error: result.reason };
}

async function recordInstall(
  result: Extract<DiscordInstallCallbackResult, { status: "ok" }>,
): Promise<DiscordInstallCallbackOutcome> {
  const recorded = await recordOwnerDiscordInstall({
    ownerUserId: result.ownerUserId,
    guildId: result.guildId,
    permissions: result.permissions,
    scopes: result.scopes,
  });
  if (recorded.status !== "recorded") {
    return { error: "missing_identity" };
  }
  // This callback owns a persisted install write, outside a Server Action. Make
  // the next Account request observe it through the same typed owner scope as
  // direct settings writes.
  updateAccountMutationScopes(accountMutationScopes.forOwner(result.ownerUserId));
  return registerCommandsForInstall(result.guildId);
}

async function registerCommandsForInstall(guildId: string): Promise<DiscordInstallCallbackOutcome> {
  const discord = discordEnvFromProcess();
  if (!discord.clientId || !discord.clientSecret) {
    return commandRegistrationWarning(guildId);
  }

  const commandSync = await syncDiscordGuildCommands({
    clientId: discord.clientId,
    clientSecret: discord.clientSecret,
    guildId,
  });
  if (commandSync.status === "failed") {
    console.error("[tendnote] Discord command registration failed", {
      guildId,
      stage: commandSync.stage,
      httpStatus: commandSync.httpStatus,
    });
    return commandRegistrationWarning(guildId);
  }

  return { installed: guildId };
}

function commandRegistrationWarning(guildId: string): DiscordInstallCallbackOutcome {
  return { installed: guildId, warning: "command_registration_failed" };
}

function buildInstallRedirectUrl(requestUrl: string, outcome: DiscordInstallCallbackOutcome): URL {
  const redirectUrl = new URL("/account/discord", requestUrl);
  for (const [key, value] of Object.entries(outcome)) {
    if (value) {
      redirectUrl.searchParams.set(key, value);
    }
  }
  return redirectUrl;
}
