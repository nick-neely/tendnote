import { describe, expect, it } from "vitest";
import { createInMemoryDiscordIdentityStore } from "./discord-identities/in-memory-store";
import { createDiscordIdentityQueries } from "./discord-identities/queries";
import type { DiscordIdentity } from "./discord-identities/types";

function identityFixture(
  input: Partial<DiscordIdentity> & { ownerUserId: string; discordUserId: string },
): DiscordIdentity {
  const now = new Date("2026-07-05T12:00:00.000Z");

  return {
    id: input.id ?? `di-${input.discordUserId}`,
    ownerUserId: input.ownerUserId,
    discordUserId: input.discordUserId,
    displayIdentity: input.displayIdentity ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

describe("Discord identity resolution", () => {
  it("resolves the persisted Tendnote owner for a mapped Discord user", async () => {
    const store = createInMemoryDiscordIdentityStore({
      discordIdentities: [identityFixture({ discordUserId: "discord-1", ownerUserId: "owner-1" })],
    });
    const queries = createDiscordIdentityQueries(store);

    await expect(queries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBe(
      "owner-1",
    );
  });

  it("fails closed for an unmapped Discord user", async () => {
    const store = createInMemoryDiscordIdentityStore({
      discordIdentities: [identityFixture({ discordUserId: "discord-1", ownerUserId: "owner-1" })],
    });
    const queries = createDiscordIdentityQueries(store);

    await expect(queries.resolveOwnerUserId({ discordUserId: "unknown" })).resolves.toBeNull();
    await expect(queries.resolveOwnerUserId({ discordUserId: "" })).resolves.toBeNull();
  });

  it("resolves two Discord users in the same guild to different Tendnote owners", async () => {
    const store = createInMemoryDiscordIdentityStore({
      discordIdentities: [
        identityFixture({ discordUserId: "discord-1", ownerUserId: "owner-1" }),
        identityFixture({ discordUserId: "discord-2", ownerUserId: "owner-2" }),
      ],
    });
    const queries = createDiscordIdentityQueries(store);

    await expect(queries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBe(
      "owner-1",
    );
    await expect(queries.resolveOwnerUserId({ discordUserId: "discord-2" })).resolves.toBe(
      "owner-2",
    );
  });

  it("links a Discord user id to a single owner and re-links the same owner idempotently", async () => {
    const store = createInMemoryDiscordIdentityStore();
    const queries = createDiscordIdentityQueries(store);

    await queries.linkDiscordIdentity({
      discordUserId: "discord-1",
      ownerUserId: "owner-1",
      displayIdentity: "handle-1",
    });
    // Re-linking the same owner is a benign update, not a conflict.
    await queries.linkDiscordIdentity({
      discordUserId: "discord-1",
      ownerUserId: "owner-1",
      displayIdentity: "handle-1-renamed",
    });

    await expect(queries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBe(
      "owner-1",
    );
    await expect(queries.listDiscordIdentities({ ownerUserId: "owner-1" })).resolves.toHaveLength(
      1,
    );
  });

  it("rejects reassigning a mapped Discord user to a different owner unless reassign is explicit", async () => {
    const store = createInMemoryDiscordIdentityStore({
      discordIdentities: [identityFixture({ discordUserId: "discord-1", ownerUserId: "owner-1" })],
    });
    const queries = createDiscordIdentityQueries(store);

    await expect(
      queries.linkDiscordIdentity({ discordUserId: "discord-1", ownerUserId: "owner-2" }),
    ).rejects.toThrow(/already mapped to a different Tendnote owner/);
    await expect(queries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBe(
      "owner-1",
    );

    // Explicit reassignment moves the single mapping to the new owner.
    await queries.linkDiscordIdentity({
      discordUserId: "discord-1",
      ownerUserId: "owner-2",
      reassign: true,
    });
    await expect(queries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBe(
      "owner-2",
    );
    await expect(queries.listDiscordIdentities({ ownerUserId: "owner-1" })).resolves.toEqual([]);
  });

  it("unlinks only a mapping the requesting owner owns", async () => {
    const store = createInMemoryDiscordIdentityStore({
      discordIdentities: [identityFixture({ discordUserId: "discord-1", ownerUserId: "owner-1" })],
    });
    const queries = createDiscordIdentityQueries(store);

    // A different owner cannot delete owner-1's mapping.
    await expect(
      queries.unlinkDiscordIdentity({ discordUserId: "discord-1", ownerUserId: "owner-2" }),
    ).resolves.toBe(false);
    await expect(queries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBe(
      "owner-1",
    );

    await expect(
      queries.unlinkDiscordIdentity({ discordUserId: "discord-1", ownerUserId: "owner-1" }),
    ).resolves.toBe(true);
    await expect(queries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBeNull();
    await expect(
      queries.unlinkDiscordIdentity({ discordUserId: "discord-1", ownerUserId: "owner-1" }),
    ).resolves.toBe(false);
  });
});
