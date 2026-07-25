import { describe, expect, it } from "vitest";
import { exposesInstantTestingApi, INSTANT_MATRIX_ENV_FLAG } from "./testing-api";

describe("instant navigation testing API gate", () => {
  it("stays off for an ordinary build that did not opt in", () => {
    expect(exposesInstantTestingApi({})).toBe(false);
  });

  it("exposes the API for an explicitly measured build", () => {
    expect(exposesInstantTestingApi({ [INSTANT_MATRIX_ENV_FLAG]: "1" })).toBe(true);
  });

  it("exposes the API for Vercel Preview so the promotion matrix can run there", () => {
    expect(exposesInstantTestingApi({ vercelEnv: "preview" })).toBe(true);
  });

  it("never exposes the API on the real production deployment", () => {
    expect(
      exposesInstantTestingApi({ vercelEnv: "production", [INSTANT_MATRIX_ENV_FLAG]: "1" }),
    ).toBe(false);
    expect(exposesInstantTestingApi({ vercelEnv: "production" })).toBe(false);
  });

  it("treats any value other than the exact opt-in as off", () => {
    expect(exposesInstantTestingApi({ [INSTANT_MATRIX_ENV_FLAG]: "0" })).toBe(false);
    expect(exposesInstantTestingApi({ [INSTANT_MATRIX_ENV_FLAG]: "true" })).toBe(false);
    expect(exposesInstantTestingApi({ [INSTANT_MATRIX_ENV_FLAG]: "" })).toBe(false);
  });
});
