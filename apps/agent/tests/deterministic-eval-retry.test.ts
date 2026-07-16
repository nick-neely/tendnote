import { describe, expect, it } from "vitest";
import {
  buildRetryDecision,
  failingEvalIds,
  summarizeEvalSamples,
} from "../scripts/deterministic-eval-retry.mjs";

type Result = { id: string; verdict: "passed" | "failed" | "scored"; error?: unknown };

describe("deterministic-grading eval retry policy", () => {
  it("retries only non-passing evals", () => {
    const results: Result[] = [
      { id: "policy/privacy", verdict: "passed" },
      { id: "policy/save-claim", verdict: "failed" },
      { id: "behavior/recall", verdict: "scored" },
    ];

    expect(failingEvalIds({ results })).toEqual(["policy/save-claim", "behavior/recall"]);
  });

  it("requires two passing samples and never loosens a substantive gate", () => {
    expect(buildRetryDecision([false, true, true])).toEqual({ passed: true, passCount: 2 });
    expect(buildRetryDecision([false, true, false])).toEqual({ passed: false, passCount: 1 });
    expect(buildRetryDecision([true])).toEqual({ passed: true, passCount: 1 });
  });

  it("summarizes recovered and persistent failures separately", () => {
    expect(
      summarizeEvalSamples(
        new Map([
          ["policy/privacy", [true]],
          ["policy/save-claim", [false, true, true]],
          ["behavior/recall", [false, true, false]],
        ]),
      ),
    ).toEqual({ passed: 2, failed: 1, recovered: 1, failedIds: ["behavior/recall"] });
  });
});
