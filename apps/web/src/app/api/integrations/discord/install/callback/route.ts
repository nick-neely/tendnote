import { affectedScopesForAccount } from "@tendnote/db/queries/general-actions";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { admittedOwnerOrNull } from "@/lib/access/current-access";
import { getBetterAuthSecret } from "@/lib/auth/server";
import { discordEnvFromProcess } from "@/lib/auth/social";
import { reconcileAffectedScopes } from "@/lib/cache/reconcile-affected-scopes";
import { syncDiscordGuildCommands } from "@/lib/integrations/discord-commands";
import {
  DISCORD_INSTALL_STATE_COOKIE,
  type DiscordInstallAuthorization,
  evaluateDiscordInstallCallback,
  resolveDiscordInstallRedirectUri,
} from "@/lib/integrations/discord-install";
import { exchangeDiscordInstallCode } from "@/lib/integrations/discord-install-exchange";
import { recordOwnerDiscordInstall } from "@/lib/integrations/discord-install-server";

type DiscordInstallCallbackOutcome = {
  installed?: string;
  error?: string;
  warning?: string;
};

/**
 * Discord bot-install callback (issue #173). Fail-closed: it records a
 * `discord_installs` row only when the signed-in owner matches the signed, fresh,
 * nonce-bound `state` AND the returned authorization `code` exchanges for a
 * provider-authoritative guild. The guild is never taken from the query string, so
 * an admitted user cannot mint a state and then claim an arbitrary guild. Always
 * clears the one-shot state cookie, then returns to the delivery settings page with
 * an outcome the UI renders.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const [sessionOwnerUserId, cookieStore] = await Promise.all([admittedOwnerOrNull(), cookies()]);
  const authorization = evaluateDiscordInstallCallback({
    sessionOwnerUserId,
    params: {
      state: params.get("state"),
      code: params.get("code"),
      error: params.get("error"),
    },
    cookieNonce: cookieStore.get(DISCORD_INSTALL_STATE_COOKIE)?.value ?? null,
    secret: getBetterAuthSecret(),
    now: Date.now(),
  });

  const outcome = await resolveInstallOutcome(authorization, request.url);
  const response = NextResponse.redirect(buildInstallRedirectUrl(request.url, outcome));
  // The state is single-use: clear the nonce cookie regardless of outcome. The
  // exchanged authorization code is likewise single-use at Discord, so a replay
  // cannot re-derive the guild even if the nonce cookie were resent.
  response.cookies.delete({
    name: DISCORD_INSTALL_STATE_COOKIE,
    path: "/api/integrations/discord/install",
  });
  return response;
}

async function resolveInstallOutcome(
  authorization: DiscordInstallAuthorization,
  requestUrl: string,
): Promise<DiscordInstallCallbackOutcome> {
  if (authorization.status !== "authorized") {
    return { error: authorization.reason };
  }

  // Credentials gate the flow at initiation too; re-check here so the exchange
  // never runs half-configured.
  const discord = discordEnvFromProcess();
  if (!discord.clientId || !discord.clientSecret) {
    return { error: "not_configured" };
  }

  // Establish the real guild from Discord, not the browser: exchange the
  // single-use code for the provider-authoritative install (token response guild).
  const exchange = await exchangeDiscordInstallCode({
    clientId: discord.clientId,
    clientSecret: discord.clientSecret,
    code: authorization.code,
    redirectUri: resolveDiscordInstallRedirectUri(requestUrl),
  });
  if (exchange.status !== "confirmed") {
    console.error("[tendnote] Discord install code exchange failed", {
      stage: exchange.stage,
      httpStatus: exchange.httpStatus,
    });
    return { error: "install_unconfirmed" };
  }

  return recordInstall({
    ownerUserId: authorization.ownerUserId,
    guildId: exchange.guildId,
    permissions: exchange.permissions,
    scopes: exchange.scopes,
  });
}

async function recordInstall(input: {
  ownerUserId: string;
  guildId: string;
  permissions: string | null;
  scopes: string[];
}): Promise<DiscordInstallCallbackOutcome> {
  const recorded = await recordOwnerDiscordInstall(input);
  if (recorded.status !== "recorded") {
    return { error: "missing_identity" };
  }
  // This callback owns a persisted install write, outside a Server Action. Make
  // the next Account request observe it through the same typed owner scope as
  // direct settings writes.
  reconcileAffectedScopes(affectedScopesForAccount(input.ownerUserId), { origin: "background" });
  return registerCommandsForInstall(input.guildId);
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
