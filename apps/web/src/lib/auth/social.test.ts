import { describe, expect, it } from "vitest";
import { githubSocialProvider, isGithubConfigured } from "./social";

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
