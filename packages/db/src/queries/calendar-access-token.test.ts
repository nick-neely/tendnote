import { describe, expect, it, vi } from "vitest";
import {
  createBetterAuthGoogleCalendarAccessTokenProvider,
  GoogleCalendarAccessTokenUnavailableError,
} from "./calendar";
import { CalendarAuthorizationError } from "./calendar/errors";

const REF = { ownerUserId: "owner-1", providerKey: "google", capabilityKey: "calendar" };

describe("createBetterAuthGoogleCalendarAccessTokenProvider", () => {
  it("returns the owner-linked Better Auth Google access token", async () => {
    const authGetAccessToken = vi.fn(
      async (input: { body: { providerId: string; userId: string } }) => {
        expect(input).toEqual({
          body: { providerId: "google", userId: "owner-1" },
        });
        return {
          accessToken: "access-token",
          accessTokenExpiresAt: new Date("2026-06-30T13:00:00.000Z"),
        };
      },
    );
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      getAccessToken: authGetAccessToken,
    });

    await expect(getAccessToken(REF)).resolves.toBe("access-token");
  });

  it("fails closed when Better Auth cannot return a usable token", async () => {
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      getAccessToken: async () => ({
        accessToken: null,
        accessTokenExpiresAt: null,
      }),
    });

    const error = await getAccessToken(REF).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CalendarAuthorizationError);
    expect(error).toMatchObject({
      cause: expect.any(GoogleCalendarAccessTokenUnavailableError),
    });
  });

  it("only serves the Google Calendar capability", async () => {
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      getAccessToken: async () => ({ accessToken: "token", accessTokenExpiresAt: null }),
    });

    await expect(
      getAccessToken({ ownerUserId: "owner-1", providerKey: "google", capabilityKey: "gmail" }),
    ).rejects.toThrow(GoogleCalendarAccessTokenUnavailableError);
  });

  it("keeps missing runtime provider configuration transient", async () => {
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      getAccessToken: async () => {
        throw { body: { code: "PROVIDER_NOT_SUPPORTED" } };
      },
    });

    await expect(getAccessToken(REF)).rejects.toMatchObject({
      body: { code: "PROVIDER_NOT_SUPPORTED" },
    });
  });
});
