import {
  createDiscordInstallQueries,
  createInMemoryDiscordInstallStore,
} from "@tendnote/db/queries/discord-installs";
import { describe, expect, it } from "vitest";
import {
  buildDiscordInstallAuthorizeUrl,
  DISCORD_BOT_INSTALL_PERMISSIONS,
  DISCORD_BOT_INSTALL_SCOPES,
  type DiscordInstallStatePayload,
  evaluateDiscordInstallCallback,
  isDiscordChannelId,
  parseDiscordInstallState,
  signDiscordInstallState,
} from "./discord-install";

const SECRET = "test-install-secret";
const NOW = Date.parse("2026-07-05T12:00:00.000Z");

function statePayload(
  overrides: Partial<DiscordInstallStatePayload> = {},
): DiscordInstallStatePayload {
  return {
    ownerUserId: overrides.ownerUserId ?? "owner-1",
    nonce: overrides.nonce ?? "nonce-abc",
    issuedAt: overrides.issuedAt ?? NOW,
  };
}

describe("buildDiscordInstallAuthorizeUrl", () => {
  it("requests bot install scopes with the guild-install integration type", () => {
    const url = new URL(
      buildDiscordInstallAuthorizeUrl({
        clientId: "client-123",
        redirectUri: "https://app.tendnote.dev/api/integrations/discord/install/callback",
        state: "signed-state",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("scope")).toBe(DISCORD_BOT_INSTALL_SCOPES.join(" "));
    expect(url.searchParams.get("permissions")).toBe(DISCORD_BOT_INSTALL_PERMISSIONS);
    expect(url.searchParams.get("response_type")).toBe("code");
    // Required because the scope includes applications.commands.
    expect(url.searchParams.get("integration_type")).toBe("0");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.tendnote.dev/api/integrations/discord/install/callback",
    );
    expect(url.searchParams.get("state")).toBe("signed-state");
  });
});

describe("isDiscordChannelId", () => {
  it("accepts 17–20 digit snowflakes and rejects everything else", () => {
    expect(isDiscordChannelId("123456789012345678")).toBe(true);
    expect(isDiscordChannelId("  123456789012345678  ")).toBe(true);
    expect(isDiscordChannelId("12345678901234567890")).toBe(true);
    expect(isDiscordChannelId("")).toBe(false);
    expect(isDiscordChannelId("   ")).toBe(false);
    expect(isDiscordChannelId("12345")).toBe(false);
    expect(isDiscordChannelId("123456789012345678901")).toBe(false);
    expect(isDiscordChannelId("12345678901234567a")).toBe(false);
    expect(isDiscordChannelId("#general")).toBe(false);
  });
});

describe("Discord install state signing", () => {
  it("round-trips a signed, session-bound state", () => {
    const payload = statePayload();
    const parsed = parseDiscordInstallState(signDiscordInstallState(payload, SECRET), SECRET);
    expect(parsed).toEqual(payload);
  });

  it("rejects a tampered payload, a wrong secret, and malformed input", () => {
    const token = signDiscordInstallState(statePayload(), SECRET);
    const [body, signature] = token.split(".");

    // Body swapped for a different owner but the original signature reused.
    const forgedBody = Buffer.from(
      JSON.stringify(statePayload({ ownerUserId: "attacker" })),
      "utf8",
    ).toString("base64url");
    expect(parseDiscordInstallState(`${forgedBody}.${signature}`, SECRET)).toBeNull();
    // Correct body, verified under a different secret.
    expect(parseDiscordInstallState(`${body}.${signature}`, "other-secret")).toBeNull();
    // Structurally invalid tokens.
    expect(parseDiscordInstallState(null, SECRET)).toBeNull();
    expect(parseDiscordInstallState("no-signature", SECRET)).toBeNull();
  });
});

describe("evaluateDiscordInstallCallback (fail-closed)", () => {
  function okState(overrides: Partial<DiscordInstallStatePayload> = {}) {
    const payload = statePayload(overrides);
    return { payload, state: signDiscordInstallState(payload, SECRET) };
  }

  it("authorizes a signed-in owner with a matching state and a returned code", () => {
    const { state } = okState();
    const result = evaluateDiscordInstallCallback({
      sessionOwnerUserId: "owner-1",
      // A forged guild_id/permissions on the query string is irrelevant now: the
      // evaluator never reads them, so it cannot leak into the authorization.
      params: { state, code: "auth-code-123" },
      cookieNonce: "nonce-abc",
      secret: SECRET,
      now: NOW,
    });

    expect(result).toEqual({
      status: "authorized",
      ownerUserId: "owner-1",
      code: "auth-code-123",
      nonce: "nonce-abc",
    });
  });

  it("fails closed when Discord returned an error (user cancelled)", () => {
    const { state } = okState();
    expect(
      evaluateDiscordInstallCallback({
        sessionOwnerUserId: "owner-1",
        params: { state, code: "auth-code-123", error: "access_denied" },
        cookieNonce: "nonce-abc",
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ status: "reject", reason: "discord_error" });
  });

  it("fails closed when there is no signed-in owner", () => {
    const { state } = okState();
    expect(
      evaluateDiscordInstallCallback({
        sessionOwnerUserId: null,
        params: { state, code: "auth-code-123" },
        cookieNonce: "nonce-abc",
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ status: "reject", reason: "unauthenticated" });
  });

  it("fails closed when the state cookie nonce does not match", () => {
    const { state } = okState();
    expect(
      evaluateDiscordInstallCallback({
        sessionOwnerUserId: "owner-1",
        params: { state, code: "auth-code-123" },
        cookieNonce: "different-nonce",
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ status: "reject", reason: "invalid_state" });
  });

  it("fails closed on an expired state", () => {
    const { state } = okState({ issuedAt: NOW - 11 * 60 * 1000 });
    expect(
      evaluateDiscordInstallCallback({
        sessionOwnerUserId: "owner-1",
        params: { state, code: "auth-code-123" },
        cookieNonce: "nonce-abc",
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ status: "reject", reason: "invalid_state" });
  });

  it("fails closed when the session owner differs from the state owner (no guild inference)", () => {
    // A valid state signed for owner-1 returned into owner-2's session must not
    // record anything — the owner is never taken from the guild or the state alone.
    const { state } = okState({ ownerUserId: "owner-1" });
    expect(
      evaluateDiscordInstallCallback({
        sessionOwnerUserId: "owner-2",
        params: { state, code: "auth-code-123" },
        cookieNonce: "nonce-abc",
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ status: "reject", reason: "owner_mismatch" });
  });

  it("fails closed when Discord returned no authorization code", () => {
    const { state } = okState();
    expect(
      evaluateDiscordInstallCallback({
        sessionOwnerUserId: "owner-1",
        params: { state, code: null },
        cookieNonce: "nonce-abc",
        secret: SECRET,
        now: NOW,
      }),
    ).toEqual({ status: "reject", reason: "missing_code" });
  });
});

describe("wired install → configure → derive (end-to-end)", () => {
  it("records a validated callback and derives the configured delivery target", async () => {
    const queries = createDiscordInstallQueries(createInMemoryDiscordInstallStore());

    // 1. A validated install callback authorizes the returning owner + code.
    const payload = statePayload();
    const decision = evaluateDiscordInstallCallback({
      sessionOwnerUserId: "owner-1",
      params: {
        state: signDiscordInstallState(payload, SECRET),
        code: "auth-code-123",
      },
      cookieNonce: "nonce-abc",
      secret: SECRET,
      now: NOW,
    });
    if (decision.status !== "authorized") {
      throw new Error(`expected authorized decision, got ${decision.reason}`);
    }

    // 2. The callback exchanges `decision.code` server-to-server for the
    //    provider-authoritative guild, then persists it (discord user id from the
    //    linked identity). Here the exchanged guild id stands in for that step.
    const exchangedGuildId = "123456789012345678";
    await queries.recordDiscordInstall({
      ownerUserId: decision.ownerUserId,
      guildId: exchangedGuildId,
      discordUserId: "discord-1",
      scopes: [...DISCORD_BOT_INSTALL_SCOPES],
      permissions: null,
    });

    // 3. The owner configures + enables a delivery target through the seams.
    await queries.configureDiscordTarget({
      ownerUserId: "owner-1",
      guildId: exchangedGuildId,
      targetKind: "channel",
      targetChannelId: "channel-99",
    });

    // 4. deriveDeliveryTarget resolves the real installed target end-to-end.
    await expect(
      queries.deriveDeliveryTarget({ ownerUserId: "owner-1", guildId: exchangedGuildId }),
    ).resolves.toEqual({
      guildId: exchangedGuildId,
      targetKind: "channel",
      targetId: "channel-99",
    });
  });
});
