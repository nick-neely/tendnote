import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listProviderConnections,
  setProviderConnectionStatus,
  connectProviderConnection,
  isProviderCapabilityConnected,
  markProviderConnectionRevoked,
  recordProviderConnectionError,
  requireAdmittedOwner,
  requireAdmittedOwnerForAction,
  updateAccountMutationScopes,
} = vi.hoisted(() => ({
  listProviderConnections: vi.fn(),
  setProviderConnectionStatus: vi.fn(),
  connectProviderConnection: vi.fn(),
  isProviderCapabilityConnected: vi.fn(),
  markProviderConnectionRevoked: vi.fn(),
  recordProviderConnectionError: vi.fn(),
  requireAdmittedOwner: vi.fn(),
  requireAdmittedOwnerForAction: vi.fn(),
  updateAccountMutationScopes: vi.fn(),
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
  requireAdmittedOwnerForAction,
}));
vi.mock("@/lib/cache/account-mutation-scopes", () => ({
  accountMutationScopes: {
    forOwner: (ownerUserId: string) => [{ kind: "account-owner", ownerUserId }],
  },
  updateAccountMutationScopes,
}));

import {
  disconnectOwnerGoogleCalendar,
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
  requireAdmittedOwnerForAction.mockReset();
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
    requireAdmittedOwnerForAction.mockResolvedValue("user-1");
    setProviderConnectionStatus.mockResolvedValue({ id: "pc-1", status: "pending" });

    await setOwnerProviderConnectionStatus({
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
  });

  it("does not mutate when the action gate denies a pending/unauthenticated caller", async () => {
    // requireAdmittedOwnerForAction fails closed (throws) for non-admitted callers.
    requireAdmittedOwnerForAction.mockRejectedValue(new Error("not admitted"));

    await expect(
      setOwnerProviderConnectionStatus({
        providerKey: "google",
        capabilityKey: "calendar",
        status: "connected",
      }),
    ).rejects.toThrow();
    expect(setProviderConnectionStatus).not.toHaveBeenCalled();
  });
});

describe("disconnectOwnerGoogleCalendar", () => {
  it("fails closed when the action gate denies the caller — nothing is revoked", async () => {
    requireAdmittedOwnerForAction.mockRejectedValue(new Error("not admitted"));

    await expect(disconnectOwnerGoogleCalendar()).rejects.toThrow();
    // The gate runs before any provider mutation; markRevoked — which also clears the
    // Calendar cache now (ADR-0080) — is never reached.
    expect(markProviderConnectionRevoked).not.toHaveBeenCalled();
  });
});

describe("disconnectOwnerGoogleContacts", () => {
  it("fails closed when the action gate denies the caller — nothing is revoked", async () => {
    requireAdmittedOwnerForAction.mockRejectedValue(new Error("not admitted"));

    await expect(disconnectOwnerGoogleContacts()).rejects.toThrow();
    expect(markProviderConnectionRevoked).not.toHaveBeenCalled();
  });

  it("marks only the Contacts capability revoked for the admitted owner", async () => {
    requireAdmittedOwnerForAction.mockResolvedValue("user-1");
    markProviderConnectionRevoked.mockResolvedValue({ status: "revoked" });

    await disconnectOwnerGoogleContacts();

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
    requireAdmittedOwnerForAction.mockResolvedValue("user-1");
    setProviderConnectionStatus.mockResolvedValue({ status: "ready" });

    await prepareOwnerGoogleContactsConnect();

    expect(setProviderConnectionStatus).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      providerKey: "google",
      capabilityKey: "contacts",
      status: "ready",
    });
  });
});
