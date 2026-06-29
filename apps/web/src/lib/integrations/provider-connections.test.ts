import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listProviderConnections,
  setProviderConnectionStatus,
  connectProviderConnection,
  requireAdmittedOwner,
  requireAdmittedOwnerForAction,
} = vi.hoisted(() => ({
  listProviderConnections: vi.fn(),
  setProviderConnectionStatus: vi.fn(),
  connectProviderConnection: vi.fn(),
  requireAdmittedOwner: vi.fn(),
  requireAdmittedOwnerForAction: vi.fn(),
}));

// `server-only` throws outside an RSC bundle; stub it so the module loads in tests.
vi.mock("server-only", () => ({}));
vi.mock("@tendnote/db/queries/provider-connections", () => ({
  listProviderConnections,
  setProviderConnectionStatus,
  connectProviderConnection,
}));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwner,
  requireAdmittedOwnerForAction,
}));

import {
  getOwnerProviderConnections,
  setOwnerProviderConnectionStatus,
} from "./provider-connections";

beforeEach(() => {
  listProviderConnections.mockReset();
  setProviderConnectionStatus.mockReset();
  requireAdmittedOwner.mockReset();
  requireAdmittedOwnerForAction.mockReset();
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
