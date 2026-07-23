import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { DISCORD_GUILD_COMMANDS, syncDiscordGuildCommands } = await import("./discord-commands");

it("registers the complete guild-command manifest with a client-credentials token", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "short-lived-token" }), { status: 200 }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(DISCORD_GUILD_COMMANDS), { status: 200 }));

  await expect(
    syncDiscordGuildCommands({
      clientId: "application-123",
      clientSecret: "secret-456",
      guildId: "guild-789",
      fetchImpl,
    }),
  ).resolves.toEqual({ status: "registered" });

  const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] ?? [];
  expect(tokenUrl).toBe("https://discord.com/api/v10/oauth2/token");
  expect(tokenInit?.method).toBe("POST");
  expect(new Headers(tokenInit?.headers).get("Authorization")).toBe(
    `Basic ${Buffer.from("application-123:secret-456").toString("base64")}`,
  );
  expect(new URLSearchParams(tokenInit?.body as URLSearchParams).get("scope")).toBe(
    "applications.commands.update",
  );

  const [commandUrl, commandInit] = fetchImpl.mock.calls[1] ?? [];
  expect(commandUrl).toBe(
    "https://discord.com/api/v10/applications/application-123/guilds/guild-789/commands",
  );
  expect(commandInit?.method).toBe("PUT");
  expect(new Headers(commandInit?.headers).get("Authorization")).toBe("Bearer short-lived-token");
  expect(JSON.parse(String(commandInit?.body))).toEqual(DISCORD_GUILD_COMMANDS);
});

it("does not register commands when Discord rejects the token request", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));

  await expect(
    syncDiscordGuildCommands({
      clientId: "application-123",
      clientSecret: "bad-secret",
      guildId: "guild-789",
      fetchImpl,
    }),
  ).resolves.toEqual({
    status: "failed",
    stage: "token_request",
    httpStatus: 401,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("returns a minimized failure when Discord rejects command synchronization", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "short-lived-token" }), { status: 200 }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 503 }));

  await expect(
    syncDiscordGuildCommands({
      clientId: "application-123",
      clientSecret: "secret-456",
      guildId: "guild-789",
      fetchImpl,
    }),
  ).resolves.toEqual({
    status: "failed",
    stage: "command_request",
    httpStatus: 503,
  });
});

it("times out a stalled Discord token request", async () => {
  const fetchImpl = vi.fn((_url, init) => rejectWhenAborted(init?.signal));

  await expect(
    syncDiscordGuildCommands({
      clientId: "application-123",
      clientSecret: "secret-456",
      guildId: "guild-789",
      fetchImpl,
      timeoutMs: 1,
    }),
  ).resolves.toEqual({ status: "failed", stage: "token_request" });
});

it("times out a stalled Discord command request", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "short-lived-token" }), { status: 200 }),
    )
    .mockImplementationOnce((_url, init) => rejectWhenAborted(init?.signal));

  await expect(
    syncDiscordGuildCommands({
      clientId: "application-123",
      clientSecret: "secret-456",
      guildId: "guild-789",
      fetchImpl,
      timeoutMs: 1,
    }),
  ).resolves.toEqual({ status: "failed", stage: "command_request" });
});

function rejectWhenAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
