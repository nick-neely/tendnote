import { GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  deriveCalendarConnection,
  googleGrantedScopes,
  parseGrantedScopes,
  reconcileGoogleCalendarConnection,
} from "./google-calendar-connection";

const CALENDAR = GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE;

describe("parseGrantedScopes", () => {
  it("reads an array of scopes", () => {
    expect(parseGrantedScopes({ providerId: "google", scopes: [CALENDAR, "email"] })).toEqual([
      CALENDAR,
      "email",
    ]);
  });

  it("splits a space- or comma-separated scope string", () => {
    expect(parseGrantedScopes({ providerId: "google", scope: `openid email ${CALENDAR}` })).toEqual(
      ["openid", "email", CALENDAR],
    );
  });
});

describe("deriveCalendarConnection", () => {
  it("returns the granted scopes (sorted) and the Google identity when Calendar is granted", () => {
    const accounts = [
      { providerId: "google", email: "owner@gmail.com", scopes: ["openid", "email", CALENDAR] },
    ];
    expect(deriveCalendarConnection(accounts)).toEqual({
      // Sorted (lexicographic) for order-stable, idempotent mirroring.
      authorizedScopes: ["email", CALENDAR, "openid"],
      displayIdentity: "owner@gmail.com",
    });
  });

  it("uses the Google account email as identity, not any session identity", () => {
    const accounts = [{ providerId: "google", email: "linked@gmail.com", scopes: [CALENDAR] }];
    expect(deriveCalendarConnection(accounts)?.displayIdentity).toBe("linked@gmail.com");
  });

  it("falls back to a null identity when the linked account exposes no email", () => {
    const accounts = [{ providerId: "google", scopes: [CALENDAR] }];
    expect(deriveCalendarConnection(accounts)?.displayIdentity).toBeNull();
  });

  it("returns null when the only Google account lacks Calendar scope", () => {
    expect(
      deriveCalendarConnection([{ providerId: "google", scopes: ["openid", "email"] }]),
    ).toBeNull();
  });

  it("ignores non-Google accounts entirely", () => {
    expect(deriveCalendarConnection([{ providerId: "github", scopes: [CALENDAR] }])).toBeNull();
    expect(googleGrantedScopes([{ providerId: "github", scopes: [CALENDAR] }])).toEqual([]);
  });
});

describe("reconcileGoogleCalendarConnection", () => {
  it("mirrors connected state, the Google identity, and sorted scopes through connect", async () => {
    const connect = vi.fn().mockResolvedValue({ status: "connected" });

    const result = await reconcileGoogleCalendarConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", email: "owner@gmail.com", scopes: ["email", CALENDAR] }],
      connect,
    });

    expect(connect).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      providerKey: "google",
      capabilityKey: "calendar",
      displayIdentity: "owner@gmail.com",
      authorizedScopes: ["email", CALENDAR],
    });
    expect(result).toEqual({ status: "connected" });
  });

  it("does not connect when Calendar access was not granted", async () => {
    const connect = vi.fn();

    const result = await reconcileGoogleCalendarConnection({
      ownerUserId: "owner-1",
      accounts: [{ providerId: "google", email: "owner@gmail.com", scopes: ["email"] }],
      connect,
    });

    expect(connect).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("preserves an authorization error until Better Auth reports a refreshed account", async () => {
    const connect = vi.fn();
    const errorAt = new Date("2026-06-30T12:00:00.000Z");
    const existing = {
      providerKey: "google",
      capabilityKey: "calendar",
      status: "error" as const,
      lastErrorAt: errorAt,
    };

    const result = await reconcileGoogleCalendarConnection({
      ownerUserId: "owner-1",
      accounts: [
        {
          providerId: "google",
          email: "owner@gmail.com",
          scopes: ["email", CALENDAR],
          updatedAt: new Date("2026-06-30T11:59:00.000Z"),
        },
      ],
      existingConnections: [existing],
      connect,
    });

    expect(connect).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it("clears the error when the linked account was refreshed after the failure", async () => {
    const connect = vi.fn().mockResolvedValue({ status: "connected" });
    const result = await reconcileGoogleCalendarConnection({
      ownerUserId: "owner-1",
      accounts: [
        {
          providerId: "google",
          email: "owner@gmail.com",
          scopes: [CALENDAR],
          updatedAt: new Date("2026-06-30T12:01:00.000Z"),
        },
      ],
      existingConnections: [
        {
          providerKey: "google",
          capabilityKey: "calendar",
          status: "error",
          lastErrorAt: new Date("2026-06-30T12:00:00.000Z"),
        },
      ],
      connect,
    });

    expect(connect).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      providerKey: "google",
      capabilityKey: "calendar",
      displayIdentity: "owner@gmail.com",
      authorizedScopes: [CALENDAR],
    });
    expect(result).toEqual({ status: "connected" });
  });
});
