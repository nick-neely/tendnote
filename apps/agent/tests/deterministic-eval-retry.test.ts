import { describe, expect, it } from "vitest";
import {
  buildRetryDecision,
  EXIT_FAILED,
  EXIT_FLAKY,
  EXIT_OK,
  exitCodeFor,
  failingEvalIds,
  sampleOutcome,
  skippedEvalIds,
  summarizeEvalSamples,
} from "../scripts/deterministic-eval-retry.mjs";

type Result = {
  id: string;
  verdict: "passed" | "failed" | "scored" | "skipped";
  error?: unknown;
};

describe("deterministic-grading eval retry policy", () => {
  it("counts only a passing verdict as a pass", () => {
    expect(sampleOutcome({ id: "a", verdict: "passed" })).toBe("passed");
    expect(sampleOutcome({ id: "a", verdict: "scored" })).toBe("failed");
    expect(sampleOutcome({ id: "a", verdict: "passed", error: "boom" })).toBe("failed");
    // A skip is its own outcome. Folding it into the pass set is how an eval that
    // never ran used to be reported as green.
    expect(sampleOutcome({ id: "a", verdict: "skipped" })).toBe("skipped");
  });

  it("retries only failing evals, and never an intentional skip", () => {
    const results: Result[] = [
      { id: "policy/privacy", verdict: "passed" },
      { id: "policy/save-claim", verdict: "failed" },
      { id: "behavior/recall", verdict: "scored" },
      { id: "behavior/parked", verdict: "skipped" },
    ];

    expect(failingEvalIds({ results })).toEqual(["policy/save-claim", "behavior/recall"]);
    expect(skippedEvalIds({ results })).toEqual(["behavior/parked"]);
  });

  it("separates a clean pass from one that only survived its retries", () => {
    expect(buildRetryDecision([true])).toMatchObject({
      passed: true,
      clean: true,
      recovered: false,
    });
    expect(buildRetryDecision([false, true, true])).toMatchObject({
      passed: true,
      clean: false,
      recovered: true,
    });
    // One retry sample still failing is a failure, not a majority vote.
    expect(buildRetryDecision([false, true, false])).toMatchObject({
      passed: false,
      recovered: false,
    });
    expect(buildRetryDecision([false, false, false])).toMatchObject({ passed: false });
  });

  it("summarizes recovered, persistent, and skipped evals separately", () => {
    expect(
      summarizeEvalSamples(
        new Map([
          ["policy/privacy", [true]],
          ["policy/save-claim", [false, true, true]],
          ["behavior/recall", [false, true, false]],
        ]),
        ["behavior/parked"],
      ),
    ).toEqual({
      passed: 2,
      failed: 1,
      recovered: 1,
      skipped: 1,
      failedIds: ["behavior/recall"],
      recoveredIds: ["policy/save-claim"],
      skippedIds: ["behavior/parked"],
    });
  });

  it("gives a recovered run its own non-zero exit code", () => {
    const clean = summarizeEvalSamples(new Map([["a", [true]]]));
    const flaky = summarizeEvalSamples(new Map([["a", [false, true, true]]]));
    const broken = summarizeEvalSamples(new Map([["a", [false, true, false]]]));

    expect(exitCodeFor(clean)).toBe(EXIT_OK);
    // Non-zero, so a run that only passed on retry cannot be read as a clean one,
    // and distinct from a real failure so the two are still tellable apart.
    expect(exitCodeFor(flaky)).toBe(EXIT_FLAKY);
    expect(exitCodeFor(broken)).toBe(EXIT_FAILED);
    expect(EXIT_FLAKY).not.toBe(EXIT_OK);
  });

  it("does not count a skipped eval toward the passing tally", () => {
    expect(summarizeEvalSamples(new Map(), ["behavior/parked"])).toMatchObject({
      passed: 0,
      failed: 0,
      skipped: 1,
    });
  });
});
