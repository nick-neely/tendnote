import { describe, expect, it } from "vitest";
import { classifyBackgroundJobFailure } from "./failure-observability";

describe("background job failure observability", () => {
  it.each([
    ["Missing AI Gateway credentials", "configuration_missing"],
    ["No transactions support in neon-http driver", "database_driver_incompatible"],
    ["foreign key constraint failed", "persistence_failure"],
    ["provider rejected schema containing private generated text", "provider_failure"],
    ["unexpected private source content", "processing_failure"],
  ])("classifies %s without returning the raw message", (message, expected) => {
    const code = classifyBackgroundJobFailure(new Error(message));
    expect(code).toBe(expected);
    expect(code).not.toContain(message);
  });
});
