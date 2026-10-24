import { describe, expect, it } from "vitest";
import type { FirstValueCheck, ModelStepResult } from "../first-value-check";
import { firstValueOutcome } from "./first-value-outcome";

function check(attempts: ModelStepResult["attempts"], passed = false): FirstValueCheck {
  return {
    status: "ran",
    failed: passed ? [] : ["model"],
    groundedAnswer: null,
    model: { passed, elapsedMs: 32_000, attempts },
  };
}
const deadline = { outcome: "deadline", phase: "gateway", elapsedMs: 15_000 } as const;
const passed = { outcome: "passed", phase: "complete", elapsedMs: 2_000 } as const;

describe("First Value sample classification", () => {
  it("counts two deadline attempts as one failed sample and retains recovered degradation", () => {
    expect(firstValueOutcome(check([deadline, deadline]))).toBe("failed");
    expect(firstValueOutcome(check([deadline, passed], true))).toBe("retried");
    expect(firstValueOutcome(check([passed], true))).toBe("clean");
  });

  it.each([408, 429, 500, 502, 503, 504])("recognizes a retryable gateway HTTP %i", (status) => {
    expect(
      firstValueOutcome(
        check([
          {
            outcome: "failed",
            phase: "gateway",
            elapsedMs: 50,
            retryable: true,
            status,
          },
        ]),
      ),
    ).toBe("failed");
  });

  it.each(["usage_ledger", "complete", "model_call"] as const)(
    "reports a %s timeout immediately instead of assuming a transient gateway error",
    (phase) => {
      expect(firstValueOutcome(check([{ ...deadline, phase }]))).toBe("serious");
    },
  );

  it.each([400, 401, 403, 404, 422, undefined])("does not debounce HTTP %s", (status) => {
    expect(
      firstValueOutcome(
        check([
          {
            outcome: "failed",
            phase: "gateway",
            elapsedMs: 50,
            retryable: true,
            status,
          },
        ]),
      ),
    ).toBe("serious");
  });

  it("holds missing/disabled/incomplete data and reports configuration or other steps immediately", () => {
    for (const value of [
      null,
      { status: "off" } as const,
      { status: "ran", failed: [], groundedAnswer: null } as const,
    ]) {
      expect(firstValueOutcome(value as FirstValueCheck | null)).toBe("unknown");
    }
    expect(firstValueOutcome(check([]))).toBe("serious");
    expect(firstValueOutcome({ status: "ran", failed: ["sign_in"], groundedAnswer: null })).toBe(
      "serious",
    );
    expect(
      firstValueOutcome({ ...check([deadline]), failed: ["checkout", "model"] } as FirstValueCheck),
    ).toBe("serious");
  });

  it("keeps authentication evidence serious even if the transport marks it retryable", () => {
    expect(
      firstValueOutcome(
        check([
          {
            outcome: "failed",
            phase: "gateway",
            elapsedMs: 50,
            retryable: true,
            status: 503,
            type: "authentication_error",
          },
        ]),
      ),
    ).toBe("serious");
    expect(firstValueOutcome(check([passed, passed], true))).toBe("unknown");
  });
});
