import { describe, expect, it } from "vitest";
import {
  createBetterAuthGoogleCalendarAccessTokenProvider,
  GoogleCalendarAccessTokenUnavailableError,
} from "./calendar";

const REF = { ownerUserId: "owner-1", providerKey: "google", capabilityKey: "calendar" };

describe("createBetterAuthGoogleCalendarAccessTokenProvider", () => {
  it("returns the owner-linked Better Auth Google access token", async () => {
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      findAccountToken: async (input) => {
        expect(input).toEqual({ ownerUserId: "owner-1", providerId: "google" });
        return {
          accessToken: "access-token",
          accessTokenExpiresAt: new Date("2026-06-30T13:00:00.000Z"),
        };
      },
      now: () => new Date("2026-06-30T12:00:00.000Z"),
    });

    await expect(getAccessToken(REF)).resolves.toBe("access-token");
  });

  it("fails closed for missing or expired tokens without exposing token details", async () => {
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      findAccountToken: async () => ({
        accessToken: "expired-token",
        accessTokenExpiresAt: new Date("2026-06-30T11:59:00.000Z"),
      }),
      now: () => new Date("2026-06-30T12:00:00.000Z"),
    });

    await expect(getAccessToken(REF)).rejects.toThrow(GoogleCalendarAccessTokenUnavailableError);
    await expect(getAccessToken(REF)).rejects.not.toThrow("expired-token");
  });

  it("only serves the Google Calendar capability", async () => {
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      findAccountToken: async () => ({ accessToken: "token", accessTokenExpiresAt: null }),
    });

    await expect(
      getAccessToken({ ownerUserId: "owner-1", providerKey: "google", capabilityKey: "gmail" }),
    ).rejects.toThrow(GoogleCalendarAccessTokenUnavailableError);
  });
});
