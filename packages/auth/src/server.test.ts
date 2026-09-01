import { describe, expect, it } from "vitest";
import {
  createTendnoteAuthOptions,
  resolveBetterAuthBaseUrl,
  resolveBetterAuthSecret,
} from "./server";

describe("Better Auth production configuration", () => {
  it("requires an explicit strong secret", () => {
    expect(() => resolveBetterAuthSecret({ NODE_ENV: "production" })).toThrow(
      "BETTER_AUTH_SECRET is required in production",
    );
    expect(() =>
      resolveBetterAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "too-short" }),
    ).toThrow("BETTER_AUTH_SECRET must be at least 32 characters");
  });

  it("requires an explicit HTTPS base URL", () => {
    expect(() => resolveBetterAuthBaseUrl({ NODE_ENV: "production" })).toThrow(
      "BETTER_AUTH_URL is required in production",
    );
    expect(() =>
      resolveBetterAuthBaseUrl({ NODE_ENV: "production", BETTER_AUTH_URL: "http://tendnote.test" }),
    ).toThrow("BETTER_AUTH_URL must use HTTPS in production");
  });

  it("uses secure cookies, the configured origin, and secondary-storage rate limits", () => {
    const options = createTendnoteAuthOptions(
      {
        database: {} as never,
        secondaryStorage: {
          delete: async () => undefined,
          get: async () => null,
          getAndDelete: async () => null,
          increment: async () => 1,
          set: async () => undefined,
        },
      },
      {
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://app.tendnote.test",
      },
    );

    expect(options.baseURL).toBe("https://app.tendnote.test");
    expect(options.trustedOrigins).toEqual(["https://app.tendnote.test"]);
    expect(options.advanced?.useSecureCookies).toBe(true);
    expect(options.rateLimit?.storage).toBe("secondary-storage");
  });
});
