import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  admittedOwnerOrNull,
  cookies,
  evaluateDiscordInstallCallback,
  recordOwnerDiscordInstall,
  updateAccountMutationScopes,
} = vi.hoisted(() => ({
  admittedOwnerOrNull: vi.fn(),
  cookies: vi.fn(),
  evaluateDiscordInstallCallback: vi.fn(),
  recordOwnerDiscordInstall: vi.fn(),
  updateAccountMutationScopes: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/access/current-access", () => ({ admittedOwnerOrNull }));
vi.mock("@/lib/auth/server", () => ({ getBetterAuthSecret: () => "test-secret" }));
vi.mock("@/lib/integrations/discord-commands", () => ({ syncDiscordGuildCommands: vi.fn() }));
vi.mock("@/lib/integrations/discord-install", () => ({
  DISCORD_INSTALL_STATE_COOKIE: "discord-install-state",
  evaluateDiscordInstallCallback,
}));
vi.mock("@/lib/integrations/discord-install-server", () => ({ recordOwnerDiscordInstall }));
vi.mock("@/lib/cache/account-mutation-scopes", () => ({
  accountMutationScopes: {
    forOwner: (ownerUserId: string) => [{ kind: "account-owner", ownerUserId }],
  },
  updateAccountMutationScopes,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  admittedOwnerOrNull.mockResolvedValue("owner-1");
  cookies.mockResolvedValue({ get: () => ({ value: "nonce-1" }) });
  evaluateDiscordInstallCallback.mockReturnValue({
    status: "ok",
    ownerUserId: "owner-1",
    guildId: "guild-1",
    permissions: "8",
    scopes: ["bot"],
  });
  recordOwnerDiscordInstall.mockResolvedValue({ status: "recorded" });
});

describe("GET /api/integrations/discord/install/callback", () => {
  it("revalidates the recorded owner's Account scope after a successful callback write", async () => {
    const response = await GET(
      new Request("https://tendnote.test/api/integrations/discord/install/callback"),
    );

    expect(response.status).toBe(307);
    expect(recordOwnerDiscordInstall).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      permissions: "8",
      scopes: ["bot"],
    });
    expect(updateAccountMutationScopes).toHaveBeenCalledWith([
      { kind: "account-owner", ownerUserId: "owner-1" },
    ]);
  });
});
