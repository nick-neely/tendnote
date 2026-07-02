import {
  createInMemoryProviderConnectionStore,
  createProviderConnectionQueries,
} from "@tendnote/db/queries/provider-connections";
import {
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  GOOGLE_CONTACTS_READONLY_SCOPE,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  CONTACTS_IDENTITY_MISMATCH_MESSAGE,
  deriveContactsConnection,
  reconcileGoogleContactsConnection,
} from "./google-contacts-connection";

const CONTACTS = GOOGLE_CONTACTS_READONLY_SCOPE;
const CALENDAR = GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE;

describe("deriveContactsConnection", () => {
  it("connects only when the Google account grants the Contacts read scope", () => {
    expect(
      deriveContactsConnection([
        { providerId: "google", email: "owner@gmail.com", scopes: ["email", CONTACTS] },
      ]),
    ).toEqual({ authorizedScopes: ["email", CONTACTS], displayIdentity: "owner@gmail.com" });
  });

  it("returns null for Calendar-only or non-Google accounts", () => {
    expect(deriveContactsConnection([{ providerId: "google", scopes: [CALENDAR] }])).toBeNull();
    expect(deriveContactsConnection([{ providerId: "github", scopes: [CONTACTS] }])).toBeNull();
  });
});

describe("reconcileGoogleContactsConnection", () => {
  it("mirrors Contacts as a separate google/contacts capability", async () => {
    const connect = vi.fn().mockResolvedValue({ status: "connected" });

    await reconcileGoogleContactsConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", email: "owner@gmail.com", scopes: [CONTACTS] }],
      connect,
    });

    expect(connect).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      providerKey: "google",
      capabilityKey: "contacts",
      displayIdentity: "owner@gmail.com",
      authorizedScopes: [CONTACTS],
    });
  });

  it("blocks a Contacts connection that uses a different linked Google identity", async () => {
    const recordError = vi.fn().mockResolvedValue({ status: "error" });

    await reconcileGoogleContactsConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", email: "other@gmail.com", scopes: [CONTACTS] }],
      existingConnections: [
        {
          id: "calendar",
          ownerUserId: "owner-1",
          providerKey: "google",
          capabilityKey: "calendar",
          status: "connected",
          displayIdentity: "owner@gmail.com",
          authorizedScopes: [CALENDAR],
          connectedAt: new Date(),
          revokedAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
          revocationReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      connect: vi.fn(),
      recordError,
    });

    expect(recordError).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      providerKey: "google",
      capabilityKey: "contacts",
      message: CONTACTS_IDENTITY_MISMATCH_MESSAGE,
    });
  });

  it("disconnecting Contacts stops future Contacts reads without deleting Tendnote data", async () => {
    const store = createInMemoryProviderConnectionStore();
    const queries = createProviderConnectionQueries(store);
    const ref = { ownerUserId: "owner-1", providerKey: "google", capabilityKey: "contacts" };

    await reconcileGoogleContactsConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", email: "owner@gmail.com", scopes: [CONTACTS] }],
      connect: queries.connectProviderConnection,
    });
    expect(await queries.isProviderCapabilityConnected(ref)).toBe(true);

    await queries.markProviderConnectionRevoked({ ...ref, reason: "user_disconnect" });

    expect(await queries.isProviderCapabilityConnected(ref)).toBe(false);
  });

  it("does not reconnect Contacts from a still-granted scope after local disconnect", async () => {
    const connect = vi.fn();

    await reconcileGoogleContactsConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", email: "owner@gmail.com", scopes: [CONTACTS] }],
      existingConnections: [
        {
          id: "contacts",
          ownerUserId: "owner-1",
          providerKey: "google",
          capabilityKey: "contacts",
          status: "revoked",
          displayIdentity: "owner@gmail.com",
          authorizedScopes: [CONTACTS],
          connectedAt: new Date(),
          revokedAt: new Date(),
          lastErrorAt: null,
          lastErrorMessage: null,
          revocationReason: "user_disconnect",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      connect,
    });

    expect(connect).not.toHaveBeenCalled();
  });
});
