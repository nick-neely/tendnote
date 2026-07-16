import { AssetValidationError, GeneralActionValidationError } from "@tendnote/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withModelSafeStoreErrors } from "../agent/lib/store-errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("model-safe tool store errors", () => {
  it("preserves curated domain validation sentences", async () => {
    const errors = [
      new AssetValidationError("Choose a narrower audience."),
      new GeneralActionValidationError("Only a routine can be paused."),
    ];

    for (const error of errors) {
      await expect(withModelSafeStoreErrors(() => Promise.reject(error))).rejects.toBe(error);
    }
  });

  it("replaces infrastructure details with one opaque model-safe sentence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = withModelSafeStoreErrors(() =>
      Promise.reject(new Error('Failed query: select * from "general_actions" params: secret')),
    );

    await expect(failure).rejects.toThrow("Could not read the user's records right now.");
    await expect(failure).rejects.not.toThrow(/general_actions|secret|select/i);
  });
});
