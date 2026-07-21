import { describe, expect, it } from "vitest";
import { appReturnTo, safeReturnTo, signInPathFor } from "./return-to";

describe("authentication return destinations", () => {
  it("preserves same-origin app paths including canonical record focus", () => {
    expect(safeReturnTo("/assets/asset-1?focus=memory-2")).toBe("/assets/asset-1?focus=memory-2");
    expect(signInPathFor("/saved-items?focus=saved-1")).toBe(
      "/sign-in?returnTo=%2Fsaved-items%3Ffocus%3Dsaved-1",
    );
  });

  it("rebuilds a record destination with its focused query state", () => {
    expect(
      appReturnTo("/assets/asset-1", {
        focus: "memory-2",
        mode: "review",
        tag: ["home", "urgent"],
      }),
    ).toBe("/assets/asset-1?focus=memory-2&mode=review&tag=home&tag=urgent");
  });

  it("rejects external, protocol-relative, auth-loop, and malformed destinations", () => {
    for (const value of [
      "https://attacker.example",
      "//attacker.example",
      "/sign-in?returnTo=/account",
      "not-a-path",
      null,
    ]) {
      expect(safeReturnTo(value)).toBe("/");
    }
  });
});
