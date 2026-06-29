import {
  createInMemoryProviderConnectionStore,
  createProviderConnectionQueries,
} from "@tendnote/db/queries/provider-connections";
import { describe, expect, it, vi } from "vitest";
import { reconcileGoogleCalendarConnection } from "./google-calendar-connection";
import { disconnectGoogleCalendar } from "./google-calendar-disconnect";

const OWNER = "owner-1";

function deps(overrides: Partial<Parameters<typeof disconnectGoogleCalendar>[0]> = {}) {
  return {
    ownerUserId: OWNER,
    revokeAndUnlink: vi.fn().mockResolvedValue({ providerRevoked: true }),
    clearCache: vi.fn().mockResolvedValue(2),
    markRevoked: vi.fn().mockResolvedValue({ status: "revoked" }),
    ...overrides,
  };
}

describe("disconnectGoogleCalendar", () => {
  it("revokes+unlinks, clears the cache, and marks the connection revoked", async () => {
    const d = deps();

    const result = await disconnectGoogleCalendar(d);

    expect(d.revokeAndUnlink).toHaveBeenCalledTimes(1);
    expect(d.clearCache).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
    });
    expect(d.markRevoked).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      reason: "user_disconnect",
    });
    expect(result).toEqual({
      providerRevoked: true,
      cacheCleared: 2,
      remainingCleanupRequired: false,
    });
  });

  it("still clears cache + marks revoked when the Google-side grant was not revoked", async () => {
    const d = deps({ revokeAndUnlink: vi.fn().mockResolvedValue({ providerRevoked: false }) });

    const result = await disconnectGoogleCalendar(d);

    expect(d.clearCache).toHaveBeenCalledTimes(1);
    expect(d.markRevoked).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "user_disconnect_provider_grant_not_revoked" }),
    );
    // ADR-0080: tell the user remaining Google Account cleanup is theirs to finish.
    expect(result.remainingCleanupRequired).toBe(true);
  });

  it("fails closed when the authoritative unlink fails: nothing is revoked or cleared", async () => {
    const d = deps({ revokeAndUnlink: vi.fn().mockRejectedValue(new Error("unlink failed")) });

    await expect(disconnectGoogleCalendar(d)).rejects.toThrow("unlink failed");
    expect(d.clearCache).not.toHaveBeenCalled();
    expect(d.markRevoked).not.toHaveBeenCalled();
  });

  it("scopes cache clearing and revocation to the disconnecting owner", async () => {
    const d = deps({ ownerUserId: "owner-2" });

    await disconnectGoogleCalendar(d);

    expect(d.clearCache).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "owner-2" }));
    expect(d.markRevoked).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "owner-2" }));
  });

  it("blocks future reads: after disconnect, a reconcile with no linked account stays revoked", async () => {
    // A real connected Calendar connection, driven through the actual product
    // mutations so the block is exercised end-to-end (not against fakes).
    const store = createInMemoryProviderConnectionStore();
    const queries = createProviderConnectionQueries(store);
    const ref = { ownerUserId: OWNER, providerKey: "google", capabilityKey: "calendar" };
    await queries.connectProviderConnection({ ...ref, displayIdentity: "owner@gmail.com" });
    expect(await queries.isProviderCapabilityConnected(ref)).toBe(true);

    await disconnectGoogleCalendar({
      ownerUserId: OWNER,
      revokeAndUnlink: vi.fn().mockResolvedValue({ providerRevoked: true }),
      clearCache: vi.fn().mockResolvedValue(0),
      markRevoked: queries.markProviderConnectionRevoked,
    });
    // The shared read-gate consumers check now refuses reads.
    expect(await queries.isProviderCapabilityConnected(ref)).toBe(false);

    // The Better Auth account is unlinked, so the account-link reconcile sees no
    // Google account and must NOT re-connect it.
    await reconcileGoogleCalendarConnection({
      ownerUserId: OWNER,
      accounts: [],
      connect: queries.connectProviderConnection,
    });

    expect(await queries.isProviderCapabilityConnected(ref)).toBe(false);
  });
});
