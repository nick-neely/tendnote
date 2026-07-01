import { describe, expect, it } from "vitest";
import {
  createBetterAuthGoogleGmailAccessTokenProvider,
  GoogleGmailAccessTokenUnavailableError,
} from "./access-token";

const GMAIL_REF = { ownerUserId: "user-1", providerKey: "google", capabilityKey: "gmail" };

describe("Google Gmail access token provider", () => {
  it("returns the Better Auth Google token for the gmail capability", async () => {
    const provider = createBetterAuthGoogleGmailAccessTokenProvider({
      findAccountToken: async () => ({ accessToken: "tok", accessTokenExpiresAt: null }),
    });
    expect(await provider(GMAIL_REF)).toBe("tok");
  });

  it("refuses to serve a token for another capability", async () => {
    const provider = createBetterAuthGoogleGmailAccessTokenProvider({
      findAccountToken: async () => ({ accessToken: "tok", accessTokenExpiresAt: null }),
    });
    await expect(
      provider({ ownerUserId: "user-1", providerKey: "google", capabilityKey: "calendar" }),
    ).rejects.toBeInstanceOf(GoogleGmailAccessTokenUnavailableError);
  });

  it("rejects a missing or expired token", async () => {
    const missing = createBetterAuthGoogleGmailAccessTokenProvider({
      findAccountToken: async () => null,
    });
    await expect(missing(GMAIL_REF)).rejects.toBeInstanceOf(GoogleGmailAccessTokenUnavailableError);

    const expired = createBetterAuthGoogleGmailAccessTokenProvider({
      findAccountToken: async () => ({
        accessToken: "tok",
        accessTokenExpiresAt: new Date("2000-01-01"),
      }),
      now: () => new Date("2030-01-01"),
    });
    await expect(expired(GMAIL_REF)).rejects.toBeInstanceOf(GoogleGmailAccessTokenUnavailableError);
  });
});
