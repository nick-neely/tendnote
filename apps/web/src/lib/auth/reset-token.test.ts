import { describe, expect, it } from "vitest";
import { resolveResetToken } from "./reset-token";

describe("resolveResetToken", () => {
  it("is ready when a token is present and there is no error", () => {
    expect(resolveResetToken({ token: "valid-token" })).toEqual({
      state: "ready",
      token: "valid-token",
    });
  });

  it("is invalid when the token is missing", () => {
    expect(resolveResetToken({})).toEqual({ state: "invalid" });
    expect(resolveResetToken({ token: null })).toEqual({ state: "invalid" });
    expect(resolveResetToken({ token: "" })).toEqual({ state: "invalid" });
  });

  it("is invalid when Better Auth reports an error, even with a token", () => {
    expect(resolveResetToken({ token: "x", error: "INVALID_TOKEN" })).toEqual({ state: "invalid" });
  });
});
