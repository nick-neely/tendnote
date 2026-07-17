import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISCORD_OAUTH_REVOKE_URL,
  revokeDiscordToken,
  revokeDiscordTokenBestEffort,
} from "./discord-revoke";

const ACCESS_TOKEN = "discord-access-token";
const CLIENT_ID = "client-id";
const CLIENT_SECRET = "client-secret";

describe("revokeDiscordToken", () => {
  it("posts the token to Discord's revoke endpoint, client-authenticated, with the token in the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const revoked = await revokeDiscordToken({
      accessToken: ACCESS_TOKEN,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
    });

    expect(revoked).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DISCORD_OAUTH_REVOKE_URL);
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    // Client-authenticated via HTTP Basic (RFC 7009), keeping the secret out of the body.
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    expect(headers.authorization).toBe(`Basic ${basic}`);

    // Token travels in the form body (never the URL) so it can't leak into logs.
    const body = new URLSearchParams(init.body as string);
    expect(body.get("token")).toBe(ACCESS_TOKEN);
    expect(body.get("token_type_hint")).toBe("access_token");
    expect(url).not.toContain(ACCESS_TOKEN);
  });

  it("returns false for a non-2xx response instead of throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      revokeDiscordToken({
        accessToken: ACCESS_TOKEN,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        fetchImpl,
      }),
    ).resolves.toBe(false);
  });
});

describe("revokeDiscordTokenBestEffort", () => {
  const ENV = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };

  function stubFetch(status: number) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("revokes the token and reports success when Discord acknowledges", async () => {
    const fetchSpy = stubFetch(200);
    const warn = vi.fn();

    const revoked = await revokeDiscordTokenBestEffort({
      env: ENV,
      getAccessToken: async () => ACCESS_TOKEN,
      warn,
    });

    expect(revoked).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["client id", { clientId: undefined, clientSecret: CLIENT_SECRET }],
    ["client secret", { clientId: CLIENT_ID, clientSecret: undefined }],
  ])("returns false without calling Discord when the %s is missing", async (_label, env) => {
    const fetchSpy = stubFetch(200);
    const getAccessToken = vi.fn();

    await expect(
      revokeDiscordTokenBestEffort({ env, getAccessToken, warn: vi.fn() }),
    ).resolves.toBe(false);
    // No credentials means no authenticated revoke is possible, so the token is never read.
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
  ])("returns false without calling Discord when the access token is %s", async (_label, token) => {
    const fetchSpy = stubFetch(200);

    await expect(
      revokeDiscordTokenBestEffort({
        env: ENV,
        getAccessToken: async () => token,
        warn: vi.fn(),
      }),
    ).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("warns and reports failure on a non-2xx response, without throwing", async () => {
    stubFetch(401);
    const warn = vi.fn();

    await expect(
      revokeDiscordTokenBestEffort({ env: ENV, getAccessToken: async () => ACCESS_TOKEN, warn }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[tendnote] Discord token revoke returned a non-success response",
    );
  });

  it("swallows a network error so disconnect still proceeds", async () => {
    const error = new Error("network down");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
    const warn = vi.fn();

    await expect(
      revokeDiscordTokenBestEffort({ env: ENV, getAccessToken: async () => ACCESS_TOKEN, warn }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[tendnote] Discord token revoke on disconnect failed",
      error,
    );
  });

  it("swallows a failure to read the access token", async () => {
    const warn = vi.fn();

    await expect(
      revokeDiscordTokenBestEffort({
        env: ENV,
        getAccessToken: async () => {
          throw new Error("no session");
        },
        warn,
      }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
