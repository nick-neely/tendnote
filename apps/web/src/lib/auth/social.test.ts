import { DISCORD_IDENTIFY_SCOPE, GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  discordSocialProvider,
  githubSocialProvider,
  googleSocialProvider,
  isDiscordConfigured,
  isGithubConfigured,
  isGoogleConfigured,
} from "./social";

describe("GitHub social configuration", () => {
  it("is configured only when both client id and secret are present", () => {
    expect(isGithubConfigured({ clientId: "id", clientSecret: "secret" })).toBe(true);
    expect(isGithubConfigured({ clientId: "id" })).toBe(false);
    expect(isGithubConfigured({ clientSecret: "secret" })).toBe(false);
    expect(isGithubConfigured({})).toBe(false);
    expect(isGithubConfigured({ clientId: "", clientSecret: "secret" })).toBe(false);
  });

  it("builds the provider config only when configured, otherwise undefined", () => {
    expect(githubSocialProvider({ clientId: "id", clientSecret: "secret" })).toEqual({
      clientId: "id",
      clientSecret: "secret",
    });
    expect(githubSocialProvider({ clientId: "id" })).toBeUndefined();
    expect(githubSocialProvider({})).toBeUndefined();
  });
});

describe("Google social configuration", () => {
  it("is configured only when both client id and secret are present", () => {
    expect(isGoogleConfigured({ clientId: "id", clientSecret: "secret" })).toBe(true);
    expect(isGoogleConfigured({ clientId: "id" })).toBe(false);
    expect(isGoogleConfigured({ clientSecret: "secret" })).toBe(false);
    expect(isGoogleConfigured({})).toBe(false);
  });

  it("requests offline access and only the base Calendar event-read scope when configured", () => {
    const provider = googleSocialProvider({ clientId: "id", clientSecret: "secret" });

    expect(provider).toEqual({
      clientId: "id",
      clientSecret: "secret",
      accessType: "offline",
      prompt: "select_account consent",
      scope: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE],
    });
    // Feature-specific Gmail and Contacts scopes are requested later via linkSocial.
    expect(provider?.scope.join(" ")).not.toMatch(/gmail|contacts/);
  });

  it("builds no provider config when unconfigured", () => {
    expect(googleSocialProvider({ clientId: "id" })).toBeUndefined();
    expect(googleSocialProvider({})).toBeUndefined();
  });
});

describe("Discord social configuration", () => {
  it("is configured only when both client id and secret are present", () => {
    expect(isDiscordConfigured({ clientId: "id", clientSecret: "secret" })).toBe(true);
    expect(isDiscordConfigured({ clientId: "id" })).toBe(false);
    expect(isDiscordConfigured({ clientSecret: "secret" })).toBe(false);
    expect(isDiscordConfigured({})).toBe(false);
  });

  it("disables the default scope and requests identify only (never email) when configured", () => {
    const provider = discordSocialProvider({ clientId: "id", clientSecret: "secret" });

    expect(provider).toEqual({
      clientId: "id",
      clientSecret: "secret",
      // Without this, Better Auth appends `scope` to its `["identify", "email"]`
      // default, so `email` would still be requested.
      disableDefaultScope: true,
      scope: [DISCORD_IDENTIFY_SCOPE],
    });
    // Phone-only / no-email Discord accounts must link without an email identity.
    expect(provider?.scope).not.toContain("email");
  });

  it("builds no provider config when unconfigured", () => {
    expect(discordSocialProvider({ clientId: "id" })).toBeUndefined();
    expect(discordSocialProvider({})).toBeUndefined();
  });
});
