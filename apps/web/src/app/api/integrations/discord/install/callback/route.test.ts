import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  admittedOwnerOrNull,
  cookies,
  evaluateDiscordInstallCallback,
  exchangeDiscordInstallCode,
  recordOwnerDiscordInstall,
  reconcileAffectedScopes,
  syncDiscordGuildCommands,
  discordEnvFromProcess,
} = vi.hoisted(() => ({
  admittedOwnerOrNull: vi.fn(),
  cookies: vi.fn(),
  evaluateDiscordInstallCallback: vi.fn(),
  exchangeDiscordInstallCode: vi.fn(),
  recordOwnerDiscordInstall: vi.fn(),
  reconcileAffectedScopes: vi.fn(),
  syncDiscordGuildCommands: vi.fn(),
  discordEnvFromProcess: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/access/current-access", () => ({ admittedOwnerOrNull }));
vi.mock("@/lib/auth/server", () => ({ getBetterAuthSecret: () => "test-secret" }));
vi.mock("@/lib/auth/social", () => ({ discordEnvFromProcess }));
vi.mock("@/lib/integrations/discord-commands", () => ({ syncDiscordGuildCommands }));
vi.mock("@/lib/integrations/discord-install", () => ({
  DISCORD_INSTALL_STATE_COOKIE: "discord-install-state",
  evaluateDiscordInstallCallback,
  resolveDiscordInstallRedirectUri: () =>
    "https://tendnote.test/api/integrations/discord/install/callback",
}));
vi.mock("@/lib/integrations/discord-install-exchange", () => ({ exchangeDiscordInstallCode }));
vi.mock("@/lib/integrations/discord-install-server", () => ({ recordOwnerDiscordInstall }));
vi.mock("@/lib/cache/reconcile-affected-scopes", () => ({ reconcileAffectedScopes }));

import { GET } from "./route";

const CALLBACK_URL = "https://tendnote.test/api/integrations/discord/install/callback";

function callback(search = "?code=auth-code-123&state=signed-state") {
  return GET(new Request(`${CALLBACK_URL}${search}`));
}

function redirectLocation(response: Response): URL {
  return new URL(response.headers.get("location") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  admittedOwnerOrNull.mockResolvedValue("owner-1");
  cookies.mockResolvedValue({ get: () => ({ value: "nonce-1" }) });
  discordEnvFromProcess.mockReturnValue({ clientId: "client-1", clientSecret: "secret-1" });
  evaluateDiscordInstallCallback.mockReturnValue({
    status: "authorized",
    ownerUserId: "owner-1",
    code: "auth-code-123",
    nonce: "nonce-1",
  });
  exchangeDiscordInstallCode.mockResolvedValue({
    status: "confirmed",
    guildId: "123456789012345678",
    scopes: ["bot", "applications.commands"],
    permissions: null,
  });
  recordOwnerDiscordInstall.mockResolvedValue({ status: "recorded" });
  syncDiscordGuildCommands.mockResolvedValue({ status: "registered" });
});

describe("GET /api/integrations/discord/install/callback", () => {
  it("exchanges the code and records the install with the provider-authoritative guild", async () => {
    const response = await callback();

    expect(response.status).toBe(307);
    // The guild persisted is the one the token exchange confirmed, never a query param.
    expect(exchangeDiscordInstallCode).toHaveBeenCalledWith({
      clientId: "client-1",
      clientSecret: "secret-1",
      code: "auth-code-123",
      redirectUri: CALLBACK_URL,
    });
    expect(recordOwnerDiscordInstall).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      guildId: "123456789012345678",
      permissions: null,
      scopes: ["bot", "applications.commands"],
    });
    expect(reconcileAffectedScopes).toHaveBeenCalledWith(
      [{ kind: "owner-collection", collection: "account", ownerUserId: "owner-1" }],
      { origin: "background" },
    );
    expect(redirectLocation(response).searchParams.get("installed")).toBe("123456789012345678");
  });

  it("rejects and records nothing when Discord returned no authorization code", async () => {
    evaluateDiscordInstallCallback.mockReturnValue({ status: "reject", reason: "missing_code" });

    const response = await callback("?state=signed-state");

    expect(exchangeDiscordInstallCode).not.toHaveBeenCalled();
    expect(recordOwnerDiscordInstall).not.toHaveBeenCalled();
    expect(redirectLocation(response).searchParams.get("error")).toBe("missing_code");
  });

  it("records nothing when a forged guild is not confirmed by the token exchange", async () => {
    // The evaluator authorized the session/state, but the code exchange (the only
    // authority on the guild) fails — so no install is persisted for a claimed guild.
    exchangeDiscordInstallCode.mockResolvedValue({ status: "failed", stage: "missing_guild" });

    const response = await callback();

    expect(recordOwnerDiscordInstall).not.toHaveBeenCalled();
    expect(reconcileAffectedScopes).not.toHaveBeenCalled();
    expect(redirectLocation(response).searchParams.get("error")).toBe("install_unconfirmed");
  });

  it("records nothing when a replayed single-use code no longer exchanges", async () => {
    // A replayed callback carries a spent authorization code; Discord rejects the
    // second exchange, so the replay cannot mint another install.
    exchangeDiscordInstallCode.mockResolvedValue({
      status: "failed",
      stage: "token_request",
      httpStatus: 400,
    });

    const response = await callback();

    expect(recordOwnerDiscordInstall).not.toHaveBeenCalled();
    expect(redirectLocation(response).searchParams.get("error")).toBe("install_unconfirmed");
  });

  it("fails closed without exchanging when Discord credentials are absent", async () => {
    discordEnvFromProcess.mockReturnValue({});

    const response = await callback();

    expect(exchangeDiscordInstallCode).not.toHaveBeenCalled();
    expect(recordOwnerDiscordInstall).not.toHaveBeenCalled();
    expect(redirectLocation(response).searchParams.get("error")).toBe("not_configured");
  });

  it("always clears the one-shot state cookie", async () => {
    const response = await callback();
    expect(response.headers.get("set-cookie")).toContain("discord-install-state=;");
  });
});
