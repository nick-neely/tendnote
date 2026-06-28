import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decidePrivateBetaAccess } from "./private-beta-decision";

describe("decidePrivateBetaAccess", () => {
  beforeEach(() => {
    vi.stubEnv("TENDNOTE_PRIVATE_BETA_EMAILS", "Beta@Example.com, second@example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("grants allowlisted emails case-insensitively", () => {
    expect(decidePrivateBetaAccess({ id: "u1", email: "beta@example.com" })).toBe(true);
    expect(decidePrivateBetaAccess({ id: "u2", email: "SECOND@EXAMPLE.COM" })).toBe(true);
  });

  it("denies non-allowlisted or missing emails", () => {
    expect(decidePrivateBetaAccess({ id: "u3", email: "nope@example.com" })).toBe(false);
    expect(decidePrivateBetaAccess({ id: "u4" })).toBe(false);
    expect(decidePrivateBetaAccess(undefined)).toBe(false);
  });

  it("denies everyone when the allowlist is empty", () => {
    vi.stubEnv("TENDNOTE_PRIVATE_BETA_EMAILS", "");
    expect(decidePrivateBetaAccess({ id: "u1", email: "beta@example.com" })).toBe(false);
  });
});
