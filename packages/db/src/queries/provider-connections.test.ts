import type { ProviderConnection } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryProviderConnectionStore } from "./provider-connections/in-memory-store";
import { createProviderConnectionQueries } from "./provider-connections/queries";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

function connectionFixture(
  input: Partial<ProviderConnection> & { ownerUserId: string },
): ProviderConnection {
  const now = new Date("2026-06-25T12:00:00.000Z");

  return {
    id: input.id ?? "pc-1",
    ownerUserId: input.ownerUserId,
    providerKey: input.providerKey ?? "google",
    capabilityKey: input.capabilityKey ?? "calendar",
    status: input.status ?? "ready",
    displayIdentity: input.displayIdentity ?? null,
    authorizedScopes: input.authorizedScopes ?? null,
    connectedAt: input.connectedAt ?? null,
    revokedAt: input.revokedAt ?? null,
    lastErrorAt: input.lastErrorAt ?? null,
    lastErrorMessage: input.lastErrorMessage ?? null,
    revocationReason: input.revocationReason ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("provider connection lifecycle", () => {
  it("creates a connection row and records a create audit entry", async () => {
    const store = createInMemoryProviderConnectionStore();
    const queries = createProviderConnectionQueries(store);

    const connection = await queries.createProviderConnection({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
    });

    expect(connection).toMatchObject({ ownerUserId: OWNER, status: "ready" });
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      {
        action: "provider_connection.create",
        entityType: "provider_connection",
        entityId: connection.id,
        metadataJson: { providerKey: "google", capabilityKey: "calendar", status: "ready" },
      },
    ]);
  });

  it("changes status, persists it, and audits the transition", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [connectionFixture({ ownerUserId: OWNER, status: "ready" })],
    });
    const queries = createProviderConnectionQueries(store);

    const updated = await queries.setProviderConnectionStatus({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      status: "pending",
    });

    expect(updated?.status).toBe("pending");
    await expect(
      queries.getProviderConnection({
        ownerUserId: OWNER,
        providerKey: "google",
        capabilityKey: "calendar",
      }),
    ).resolves.toMatchObject({ status: "pending" });
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      {
        action: "provider_connection.status_change",
        metadataJson: { from: "ready", to: "pending" },
      },
    ]);
  });

  it("stamps the lifecycle timestamp matching the target status", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [connectionFixture({ ownerUserId: OWNER, status: "connected" })],
    });
    const queries = createProviderConnectionQueries(store);

    const revoked = await queries.setProviderConnectionStatus({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      status: "revoked",
    });

    // Reaching `revoked` via setStatus stamps revokedAt, like markProviderConnectionRevoked.
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });

  it("does not write an audit entry for a no-op status change", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [connectionFixture({ ownerUserId: OWNER, status: "ready" })],
    });
    const queries = createProviderConnectionQueries(store);

    const result = await queries.setProviderConnectionStatus({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      status: "ready",
    });

    expect(result?.status).toBe("ready");
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual([]);
  });

  it("records an error as visible status with an audit entry", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [connectionFixture({ ownerUserId: OWNER, status: "pending" })],
    });
    const queries = createProviderConnectionQueries(store);

    const updated = await queries.recordProviderConnectionError({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      message: "authorization failed",
    });

    expect(updated?.status).toBe("error");
    expect(updated?.lastErrorMessage).toBe("authorization failed");
    expect(updated?.lastErrorAt).toBeInstanceOf(Date);
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      { action: "provider_connection.error", metadataJson: { message: "authorization failed" } },
    ]);
  });

  it("marks a placeholder revocation state with an audit entry, and re-revoking is a no-op", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [connectionFixture({ ownerUserId: OWNER, status: "connected" })],
    });
    const queries = createProviderConnectionQueries(store);

    const revoked = await queries.markProviderConnectionRevoked({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      reason: "user requested",
    });

    expect(revoked?.status).toBe("revoked");
    expect(revoked?.revokedAt).toBeInstanceOf(Date);

    // Re-revoking changes nothing and writes no new audit entry.
    await queries.markProviderConnectionRevoked({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
    });

    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      {
        action: "provider_connection.revoke",
        metadataJson: { from: "connected", reason: "user requested" },
      },
    ]);
  });

  it("returns only the requesting owner's connection state", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [
        connectionFixture({ id: "mine", ownerUserId: OWNER }),
        connectionFixture({ id: "theirs", ownerUserId: OTHER_OWNER }),
      ],
    });
    const queries = createProviderConnectionQueries(store);

    const mine = await queries.listProviderConnections({ ownerUserId: OWNER });
    expect(mine.map((c) => c.id)).toEqual(["mine"]);
  });

  it("does not mutate another owner's connection and writes no audit entry", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [connectionFixture({ id: "mine", ownerUserId: OWNER, status: "ready" })],
    });
    const queries = createProviderConnectionQueries(store);

    // OTHER_OWNER references the same provider/capability but a different owner: no row.
    await expect(
      queries.setProviderConnectionStatus({
        ownerUserId: OTHER_OWNER,
        providerKey: "google",
        capabilityKey: "calendar",
        status: "connected",
      }),
    ).resolves.toBeNull();

    await expect(store.listAuditLogEntries({ ownerUserId: OTHER_OWNER })).resolves.toEqual([]);
    // The owner's row is untouched.
    await expect(
      queries.getProviderConnection({
        ownerUserId: OWNER,
        providerKey: "google",
        capabilityKey: "calendar",
      }),
    ).resolves.toMatchObject({ status: "ready" });
  });

  it("rejects an invalid provider key at the product boundary", async () => {
    const queries = createProviderConnectionQueries(createInMemoryProviderConnectionStore());

    await expect(
      queries.createProviderConnection({
        ownerUserId: OWNER,
        providerKey: "Google",
        capabilityKey: "calendar",
      }),
    ).rejects.toThrow();
  });

  it("connects a brand-new capability, mirroring identity and scopes, with a connect audit", async () => {
    const store = createInMemoryProviderConnectionStore();
    const queries = createProviderConnectionQueries(store);

    const connection = await queries.connectProviderConnection({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      displayIdentity: "owner@example.com",
      authorizedScopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    });

    expect(connection).toMatchObject({
      status: "connected",
      displayIdentity: "owner@example.com",
      authorizedScopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    });
    expect(connection?.connectedAt).toBeInstanceOf(Date);
    // Non-secret only: no token-shaped fields exist on the row.
    expect(Object.keys(connection ?? {})).not.toContain("accessToken");
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      { action: "provider_connection.connect", metadataJson: { from: null, created: true } },
    ]);
  });

  it("re-connecting an error'd connection clears error state and re-audits", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [
        connectionFixture({
          ownerUserId: OWNER,
          status: "error",
          lastErrorAt: new Date("2026-06-20T00:00:00.000Z"),
          lastErrorMessage: "auth failed",
        }),
      ],
    });
    const queries = createProviderConnectionQueries(store);

    const updated = await queries.connectProviderConnection({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      displayIdentity: "owner@example.com",
      authorizedScopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    });

    expect(updated).toMatchObject({
      status: "connected",
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      { action: "provider_connection.connect", metadataJson: { from: "error", created: false } },
    ]);
  });

  it("is idempotent: re-connecting with identical identity and scopes writes no audit", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [
        connectionFixture({
          ownerUserId: OWNER,
          status: "connected",
          displayIdentity: "owner@example.com",
          authorizedScopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
          connectedAt: new Date("2026-06-25T12:00:00.000Z"),
        }),
      ],
    });
    const queries = createProviderConnectionQueries(store);

    const result = await queries.connectProviderConnection({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      displayIdentity: "owner@example.com",
      authorizedScopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    });

    expect(result).toMatchObject({ status: "connected" });
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual([]);
  });

  it("scopes connect to the owner: connecting for one owner leaves another owner untouched", async () => {
    const store = createInMemoryProviderConnectionStore({
      providerConnections: [connectionFixture({ ownerUserId: OTHER_OWNER, status: "ready" })],
    });
    const queries = createProviderConnectionQueries(store);

    await queries.connectProviderConnection({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      displayIdentity: "owner@example.com",
    });

    await expect(
      queries.getProviderConnection({
        ownerUserId: OTHER_OWNER,
        providerKey: "google",
        capabilityKey: "calendar",
      }),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(store.listAuditLogEntries({ ownerUserId: OTHER_OWNER })).resolves.toEqual([]);
  });
});
