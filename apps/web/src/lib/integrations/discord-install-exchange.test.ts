import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { exchangeDiscordInstallCode } = await import("./discord-install-exchange");

const CONFIRMED_GUILD_ID = "123456789012345678";
const REDIRECT_URI = "https://tendnote.test/api/integrations/discord/install/callback";

function exchange(fetchImpl: typeof fetch, overrides: Partial<{ code: string }> = {}) {
  return exchangeDiscordInstallCode({
    clientId: "client-1",
    clientSecret: "secret-1",
    code: overrides.code ?? "auth-code-123",
    redirectUri: REDIRECT_URI,
    fetchImpl,
  });
}

it("exchanges the code and returns the provider-authoritative guild + scopes", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: "install-token",
        scope: "bot applications.commands",
        guild: { id: CONFIRMED_GUILD_ID, name: "SomeTest" },
      }),
      { status: 200 },
    ),
  );

  await expect(exchange(fetchImpl)).resolves.toEqual({
    status: "confirmed",
    guildId: CONFIRMED_GUILD_ID,
    scopes: ["bot", "applications.commands"],
    permissions: null,
  });

  const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] ?? [];
  expect(tokenUrl).toBe("https://discord.com/api/v10/oauth2/token");
  expect(tokenInit?.method).toBe("POST");
  expect(new Headers(tokenInit?.headers).get("Authorization")).toBe(
    `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
  );
  const body = new URLSearchParams(tokenInit?.body as URLSearchParams);
  expect(body.get("grant_type")).toBe("authorization_code");
  expect(body.get("code")).toBe("auth-code-123");
  expect(body.get("redirect_uri")).toBe(REDIRECT_URI);
});

it("fails when Discord rejects the code (a spent single-use code replay)", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));

  await expect(exchange(fetchImpl)).resolves.toEqual({
    status: "failed",
    stage: "token_request",
    httpStatus: 400,
  });
});

it("fails closed when the token response carries no guild (bot was not installed)", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ access_token: "t", scope: "identify" }), { status: 200 }),
    );

  await expect(exchange(fetchImpl)).resolves.toEqual({ status: "failed", stage: "missing_guild" });
});

it("rejects a guild id that is not a valid snowflake", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ access_token: "t", guild: { id: "not-a-snowflake" } }), {
      status: 200,
    }),
  );

  await expect(exchange(fetchImpl)).resolves.toEqual({ status: "failed", stage: "invalid_guild" });
});

it("fails when the token response is not valid JSON", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>nope</html>", { status: 200 }));

  await expect(exchange(fetchImpl)).resolves.toEqual({ status: "failed", stage: "token_response" });
});

it("defaults to the requested scopes when the response omits scope", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ access_token: "t", guild: { id: CONFIRMED_GUILD_ID } }), {
      status: 200,
    }),
  );

  await expect(exchange(fetchImpl)).resolves.toMatchObject({
    status: "confirmed",
    scopes: ["bot", "applications.commands"],
  });
});
