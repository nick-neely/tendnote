import "server-only";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_COMMAND_UPDATE_SCOPE = "applications.commands.update";

/** Authoritative guild-command manifest synchronized after a Tendnote bot install. */
export const DISCORD_GUILD_COMMANDS = [
  {
    name: "capture",
    description: "Capture private relationship context in Tendnote",
    type: 1,
    options: [
      {
        name: "message",
        description: "What should Tendnote capture?",
        type: 3,
        required: true,
      },
    ],
  },
] as const;

export type DiscordCommandSyncResult =
  | { status: "registered" }
  | {
      status: "failed";
      stage: "token_request" | "token_response" | "command_request";
      httpStatus?: number;
    };

/**
 * Synchronize Tendnote's complete command manifest into one installed guild.
 *
 * Uses Discord's client-credentials grant rather than the bot token: the web app
 * already owns the OAuth client id/secret, while the bot token remains isolated
 * in the agent app. Bulk overwrite is idempotent and makes reinstalling a safe
 * retry when a transient Discord failure interrupts registration.
 */
export async function syncDiscordGuildCommands(input: {
  clientId: string;
  clientSecret: string;
  guildId: string;
  fetchImpl?: typeof fetch;
}): Promise<DiscordCommandSyncResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const tokenBody = new URLSearchParams({
    grant_type: "client_credentials",
    scope: DISCORD_COMMAND_UPDATE_SCOPE,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchImpl(`${DISCORD_API_BASE_URL}/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString(
          "base64",
        )}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
      cache: "no-store",
    });
  } catch {
    return { status: "failed", stage: "token_request" };
  }

  if (!tokenResponse.ok) {
    return {
      status: "failed",
      stage: "token_request",
      httpStatus: tokenResponse.status,
    };
  }

  let accessToken: string | undefined;
  try {
    const payload = (await tokenResponse.json()) as { access_token?: unknown };
    accessToken = typeof payload.access_token === "string" ? payload.access_token : undefined;
  } catch {
    // Fall through to the minimized invalid-response result below.
  }
  if (!accessToken) {
    return { status: "failed", stage: "token_response" };
  }

  let commandResponse: Response;
  try {
    commandResponse = await fetchImpl(
      `${DISCORD_API_BASE_URL}/applications/${encodeURIComponent(
        input.clientId,
      )}/guilds/${encodeURIComponent(input.guildId)}/commands`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(DISCORD_GUILD_COMMANDS),
        cache: "no-store",
      },
    );
  } catch {
    return { status: "failed", stage: "command_request" };
  }

  return commandResponse.ok
    ? { status: "registered" }
    : {
        status: "failed",
        stage: "command_request",
        httpStatus: commandResponse.status,
      };
}
