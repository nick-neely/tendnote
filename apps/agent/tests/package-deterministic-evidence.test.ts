import { describe, expect, it } from "vitest";
import { buildEvidenceMetadata } from "../scripts/package-deterministic-evidence.mjs";

const sourceCommit = "a".repeat(40);
const base = {
  sourceCommit,
  workflowUrl: "https://github.com/nick-neely/tendnote/actions/runs/1",
  command: "pnpm --filter @tendnote/agent eval:deterministic",
  agentModel: "anthropic/claude-sonnet-5",
  exitCode: 0,
  reports: [
    {
      startedAt: "2026-08-20T20:00:00.000Z",
      completedAt: "2026-08-20T20:10:00.000Z",
      passed: 62,
      failed: 0,
      skipped: 0,
      errored: 0,
      totalEvals: 62,
      evals: [
        {
          runtimeIdentity: {
            modelId: "anthropic/claude-sonnet-5",
            eveVersion: "0.32.0",
          },
        },
      ],
    },
  ],
  junit: { tests: 62, failures: 0, skipped: 0 },
  packagedAt: "2026-08-20T20:10:01.000Z",
};

describe("deterministic publication evidence classification", () => {
  it("accepts only a complete first-sample-clean report", () => {
    expect(buildEvidenceMetadata(base)).toMatchObject({
      sourceCommit,
      clean: true,
      counts: { passed: 62, failed: 0, skipped: 0, errored: 0, total: 62 },
      retry: { attempted: false, rounds: 0 },
      configuration: { agentModel: "anthropic/claude-sonnet-5", eveVersion: "0.32.0" },
    });
  });

  it("blocks a recovered retry even when the wrapper eventually reports passes", () => {
    const retry = { ...base.reports[0], startedAt: "2026-08-20T20:11:00.000Z" };
    expect(
      buildEvidenceMetadata({ ...base, exitCode: 3, reports: [...base.reports, retry] }),
    ).toMatchObject({
      clean: false,
      retry: { attempted: true, rounds: 1 },
    });
  });

  it("blocks skipped, missing, and machine-report disagreement", () => {
    expect(
      buildEvidenceMetadata({
        ...base,
        reports: [{ ...base.reports[0], passed: 61, skipped: 1 }],
      }).clean,
    ).toBe(false);
    expect(
      buildEvidenceMetadata({ ...base, junit: { tests: 61, failures: 0, skipped: 0 } }).clean,
    ).toBe(false);
    expect(() => buildEvidenceMetadata({ ...base, reports: [] })).toThrow(/bootstrap failure/i);
  });
});
