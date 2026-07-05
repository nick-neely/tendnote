import { describe, expect, it, vi } from "vitest";
import { DISCORD_OAUTH_REVOKE_URL, revokeDiscordToken } from "./discord-revoke";

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
