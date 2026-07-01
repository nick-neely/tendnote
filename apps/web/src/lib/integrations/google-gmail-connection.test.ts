import {
  createInMemoryProviderConnectionStore,
  createProviderConnectionQueries,
} from "@tendnote/db/queries/provider-connections";
import {
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  GOOGLE_GMAIL_COMPOSE_SCOPE,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { reconcileGoogleCalendarConnection } from "./google-calendar-connection";
import { deriveGmailConnection, reconcileGoogleGmailConnection } from "./google-gmail-connection";

const CALENDAR = GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE;
const GMAIL = GOOGLE_GMAIL_COMPOSE_SCOPE;

describe("deriveGmailConnection", () => {
  it("connects when the Google account grants the Gmail compose scope", () => {
    const accounts = [{ providerId: "google", email: "owner@gmail.com", scopes: ["email", GMAIL] }];
    expect(deriveGmailConnection(accounts)).toEqual({
      authorizedScopes: ["email", GMAIL],
      displayIdentity: "owner@gmail.com",
    });
  });

  it("returns null when only Calendar (not Gmail) scope is granted", () => {
    expect(deriveGmailConnection([{ providerId: "google", scopes: [CALENDAR] }])).toBeNull();
  });

  it("ignores non-Google accounts", () => {
    expect(deriveGmailConnection([{ providerId: "github", scopes: [GMAIL] }])).toBeNull();
  });
});

describe("reconcileGoogleGmailConnection", () => {
  it("mirrors Gmail as the google/gmail capability, independent of calendar", async () => {
    const connect = vi.fn().mockResolvedValue({ status: "connected" });

    await reconcileGoogleGmailConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", email: "owner@gmail.com", scopes: ["email", GMAIL] }],
      connect,
    });

    expect(connect).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      providerKey: "google",
      capabilityKey: "gmail",
      displayIdentity: "owner@gmail.com",
      authorizedScopes: ["email", GMAIL],
    });
  });

  it("does not connect Gmail when only Calendar scope is granted", async () => {
    const connect = vi.fn();
    const result = await reconcileGoogleGmailConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", scopes: [CALENDAR] }],
      connect,
    });
    expect(connect).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("downgrades a stale connected Gmail row when the shared account was unlinked", async () => {
    // The Google account is gone (unlinked by a Calendar disconnect): no scopes at all.
    const connect = vi.fn();
    const revoke = vi.fn().mockResolvedValue({ status: "revoked" });
    const isConnected = vi.fn().mockResolvedValue(true);

    const result = await reconcileGoogleGmailConnection({
      ownerUserId: "owner-1",
      accounts: [],
      connect,
      isConnected,
      revoke,
    });

    expect(connect).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      providerKey: "google",
      capabilityKey: "gmail",
      reason: "google_account_unlinked",
    });
    expect(result).toEqual({ status: "revoked" });
  });

  it("does not revoke when Gmail was never connected (nothing to downgrade)", async () => {
    const revoke = vi.fn();
    const isConnected = vi.fn().mockResolvedValue(false);

    const result = await reconcileGoogleGmailConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", scopes: [CALENDAR] }],
      connect: vi.fn(),
      isConnected,
      revoke,
    });

    expect(revoke).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe("Calendar/Gmail capability independence", () => {
  it("connecting Gmail leaves Calendar not-connected and vice versa", async () => {
    const store = createInMemoryProviderConnectionStore();
    const queries = createProviderConnectionQueries(store);
    const ownerUserId = "owner-1";

    // Only the Gmail scope is granted: Gmail connects, Calendar stays unconnected.
    const gmailOnly = [{ providerId: "google", email: "owner@gmail.com", scopes: [GMAIL] }];
    await reconcileGoogleGmailConnection({
      ownerUserId,
      accounts: gmailOnly,
      connect: queries.connectProviderConnection,
    });
    await reconcileGoogleCalendarConnection({
      ownerUserId,
      accounts: gmailOnly,
      connect: queries.connectProviderConnection,
    });

    expect(
      await queries.isProviderCapabilityConnected({
        ownerUserId,
        providerKey: "google",
        capabilityKey: "gmail",
      }),
    ).toBe(true);
    expect(
      await queries.isProviderCapabilityConnected({
        ownerUserId,
        providerKey: "google",
        capabilityKey: "calendar",
      }),
    ).toBe(false);
  });

  it("revokes a connected Gmail row when the shared Google account is later unlinked", async () => {
    const store = createInMemoryProviderConnectionStore();
    const queries = createProviderConnectionQueries(store);
    const ownerUserId = "owner-1";
    const ref = { ownerUserId, providerKey: "google", capabilityKey: "gmail" };

    // Gmail is connected, then the shared account is unlinked (accounts empty).
    await reconcileGoogleGmailConnection({
      ownerUserId,
      accounts: [{ providerId: "google", email: "owner@gmail.com", scopes: [GMAIL] }],
      connect: queries.connectProviderConnection,
    });
    expect(await queries.isProviderCapabilityConnected(ref)).toBe(true);

    await reconcileGoogleGmailConnection({
      ownerUserId,
      accounts: [],
      connect: queries.connectProviderConnection,
      isConnected: queries.isProviderCapabilityConnected,
      revoke: queries.markProviderConnectionRevoked,
    });

    const gmail = await queries.getProviderConnection(ref);
    expect(gmail?.status).toBe("revoked");
  });

  it("recording a Gmail auth error does not mark Calendar errored", async () => {
    const store = createInMemoryProviderConnectionStore();
    const queries = createProviderConnectionQueries(store);
    const ownerUserId = "owner-1";
    const bothScopes = [
      { providerId: "google", email: "owner@gmail.com", scopes: [CALENDAR, GMAIL] },
    ];

    await reconcileGoogleCalendarConnection({
      ownerUserId,
      accounts: bothScopes,
      connect: queries.connectProviderConnection,
    });
    await reconcileGoogleGmailConnection({
      ownerUserId,
      accounts: bothScopes,
      connect: queries.connectProviderConnection,
    });

    // A Gmail provider auth failure updates only the Gmail connection (ADR-0091).
    await queries.recordProviderConnectionError({
      ownerUserId,
      providerKey: "google",
      capabilityKey: "gmail",
      message: "gmail token revoked",
    });

    const gmail = await queries.getProviderConnection({
      ownerUserId,
      providerKey: "google",
      capabilityKey: "gmail",
    });
    const calendar = await queries.getProviderConnection({
      ownerUserId,
      providerKey: "google",
      capabilityKey: "calendar",
    });
    expect(gmail?.status).toBe("error");
    // Calendar is untouched: no status coupling between capabilities.
    expect(calendar?.status).toBe("connected");
  });
});
