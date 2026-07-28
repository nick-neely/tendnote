import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listProviderConnections,
  setProviderConnectionStatus,
  connectProviderConnection,
  isProviderCapabilityConnected,
  markProviderConnectionRevoked,
  recordProviderConnectionError,
  requireAdmittedOwner,
} = vi.hoisted(() => ({
  listProviderConnections: vi.fn(),
  setProviderConnectionStatus: vi.fn(),
  connectProviderConnection: vi.fn(),
  isProviderCapabilityConnected: vi.fn(),
  markProviderConnectionRevoked: vi.fn(),
  recordProviderConnectionError: vi.fn(),
  requireAdmittedOwner: vi.fn(),
}));

// `server-only` throws outside an RSC bundle; stub it so the module loads in tests.
vi.mock("server-only", () => ({}));
vi.mock("@tendnote/db/queries/provider-connections", () => ({
  listProviderConnections,
  setProviderConnectionStatus,
  connectProviderConnection,
  isProviderCapabilityConnected,
  markProviderConnectionRevoked,
  recordProviderConnectionError,
}));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwner,
}));
vi.mock("@/lib/cache/reconcile-affected-scopes", () => ({ reconcileAffectedScopes: vi.fn() }));

import {
  disconnectOwnerGoogleContacts,
  getOwnerProviderConnections,
  prepareOwnerGoogleContactsConnect,
  setOwnerProviderConnectionStatus,
} from "./provider-connections";

beforeEach(() => {
  listProviderConnections.mockReset();
  setProviderConnectionStatus.mockReset();
  connectProviderConnection.mockReset();
  isProviderCapabilityConnected.mockReset();
  requireAdmittedOwner.mockReset();
  markProviderConnectionRevoked.mockReset();
  recordProviderConnectionError.mockReset();
});

describe("getOwnerProviderConnections", () => {
  it("reads connection state scoped to the resolved admitted owner", async () => {
    requireAdmittedOwner.mockResolvedValue("user-1");
    listProviderConnections.mockResolvedValue([{ id: "pc-1", ownerUserId: "user-1" }]);

    const result = await getOwnerProviderConnections();

    expect(listProviderConnections).toHaveBeenCalledWith({ ownerUserId: "user-1" });
    expect(result).toEqual([{ id: "pc-1", ownerUserId: "user-1" }]);
  });

  it("does not read connection state when the admitted-access gate denies the caller", async () => {
    // requireAdmittedOwner redirects pending/unauthenticated callers (throws here).
    requireAdmittedOwner.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(getOwnerProviderConnections()).rejects.toThrow();
    expect(listProviderConnections).not.toHaveBeenCalled();
  });
});

describe("setOwnerProviderConnectionStatus", () => {
  it("mutates status scoped to the resolved admitted owner", async () => {
    setProviderConnectionStatus.mockResolvedValue({ id: "pc-1", status: "pending" });

    const outcome = await setOwnerProviderConnectionStatus({
      ownerUserId: "user-1",
      providerKey: "google",
      capabilityKey: "calendar",
      status: "pending",
    });

    expect(setProviderConnectionStatus).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      providerKey: "google",
      capabilityKey: "calendar",
      status: "pending",
    });
    expect(outcome.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "account", ownerUserId: "user-1" },
    ]);
  });
});

describe("disconnectOwnerGoogleContacts", () => {
  it("marks only the Contacts capability revoked for the admitted owner", async () => {
    markProviderConnectionRevoked.mockResolvedValue({ status: "revoked" });

    await disconnectOwnerGoogleContacts({ ownerUserId: "user-1" });

    expect(markProviderConnectionRevoked).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      providerKey: "google",
      capabilityKey: "contacts",
      reason: "user_disconnect",
    });
  });
});

describe("prepareOwnerGoogleContactsConnect", () => {
  it("clears only the local Contacts connection state after an admitted owner explicitly reconnects", async () => {
    setProviderConnectionStatus.mockResolvedValue({ status: "ready" });

    await prepareOwnerGoogleContactsConnect({ ownerUserId: "user-1" });

    expect(setProviderConnectionStatus).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      providerKey: "google",
      capabilityKey: "contacts",
      status: "ready",
    });
  });
});
