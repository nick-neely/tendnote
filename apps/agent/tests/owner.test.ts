import { describe, expect, it } from "vitest";
import { resolveOwnerUserId } from "../agent/lib/owner";

describe("resolveOwnerUserId", () => {
  it("returns the authenticated Eve principal", () => {
    expect(
      resolveOwnerUserId({
        session: { auth: { current: { principalId: "user-123" } } },
      }),
    ).toBe("user-123");
  });

  it("never invents a hosted demo owner when authentication is missing", () => {
    expect(() => resolveOwnerUserId({ session: { auth: { current: null } } })).toThrow(
      "An authenticated Tendnote owner is required",
    );
  });
});
