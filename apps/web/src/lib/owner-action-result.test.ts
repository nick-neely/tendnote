import { describe, expect, it } from "vitest";
import {
  OwnerActionFailure,
  ownerActionFailureMessage,
  unwrapOwnerActionResult,
} from "./owner-action-result";

describe("owner action result consumer", () => {
  it("returns the successful view", () => {
    expect(unwrapOwnerActionResult({ ok: true, view: { id: "record-1" } })).toEqual({
      id: "record-1",
    });
  });

  it("brands curated failures so only those messages are owner-visible", () => {
    const failure = new OwnerActionFailure("Product limit reached. Try again shortly.");
    expect(() =>
      unwrapOwnerActionResult({
        ok: false,
        error: "Product limit reached. Try again shortly.",
      }),
    ).toThrow(failure.message);
    expect(ownerActionFailureMessage(failure)).toBe(failure.message);
    expect(ownerActionFailureMessage(new Error("database host unavailable"))).toBeNull();
  });
});
