import { describe, expect, it } from "vitest";
import { buildEvidenceMetadata } from "../scripts/package-deterministic-evidence.mjs";

const sourceCommit = "a".repeat(40);
const base = {
  sourceCommit,
  workflowUrl: "https://github.com/nick-neely/tendnote/actions/runs/1",
  command: "pnpm --filter @tendnote/agent eval:deterministic",
  agentModel: "google/gemini-3.7-flash",
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
      evals: Array.from({ length: 62 }, (_, index) => ({
        id: `eval-${index}`,
        result: {
          status: "completed",
          events: [
            {
              type: "session.started",
              data: {
                runtime: {
                  modelId: "google/gemini-3.7-flash",
                  eveVersion: "0.32.0",
                },
              },
            },
          ],
        },
      })),
    },
  ],
  resultRows: [
    Array.from({ length: 62 }, (_, index) => ({
      id: `eval-${index}`,
      verdict: "passed",
      status: "completed",
    })),
  ],
  junit: {
    tests: 62,
    failures: 0,
    skipped: 0,
    ids: Array.from({ length: 62 }, (_, index) => `eval-${index}`),
  },
  packagedAt: "2026-08-20T20:10:01.000Z",
};

describe("deterministic publication evidence classification", () => {
  it("accepts only a complete first-sample-clean report", () => {
    expect(buildEvidenceMetadata(base)).toMatchObject({
      sourceCommit,
      clean: true,
      counts: { passed: 62, failed: 0, skipped: 0, errored: 0, total: 62 },
      retry: { attempted: false, rounds: 0 },
      configuration: { agentModel: "google/gemini-3.7-flash", eveVersion: "0.32.0" },
      statuses: { completed: 62 },
      evalIds: expect.arrayContaining(["eval-0", "eval-61"]),
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
    const firstRow = base.resultRows.at(0)?.at(0) ?? {
      id: "missing",
      verdict: "passed",
      status: "completed",
    };
    expect(
      buildEvidenceMetadata({
        ...base,
        reports: [{ ...base.reports[0], passed: 61, skipped: 1 }],
      }).clean,
    ).toBe(false);
    expect(
      buildEvidenceMetadata({
        ...base,
        junit: { tests: 61, failures: 0, skipped: 0, ids: base.junit.ids },
      }).clean,
    ).toBe(false);
    expect(() => buildEvidenceMetadata({ ...base, reports: [] })).toThrow(/bootstrap failure/i);
    expect(buildEvidenceMetadata({ ...base, resultRows: [[firstRow]] }).clean).toBe(false);
    expect(
      buildEvidenceMetadata({
        ...base,
        resultRows: [[{ ...firstRow, verdict: "failed" }]],
      }).clean,
    ).toBe(false);
  });

  it("fails closed when runtime identity is missing, inconsistent, or unexpected", () => {
    expect(() =>
      buildEvidenceMetadata({
        ...base,
        reports: [{ ...base.reports[0], evals: [{ result: { status: "completed", events: [] } }] }],
      }),
    ).toThrow(/no session.started/i);
    expect(() =>
      buildEvidenceMetadata({
        ...base,
        reports: [
          {
            ...base.reports[0],
            evals: [
              ...(base.reports.at(0)?.evals ?? []),
              {
                result: {
                  status: "completed",
                  events: [
                    {
                      type: "session.started",
                      data: { runtime: { modelId: "openai/gpt-5.4", eveVersion: "0.32.0" } },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toThrow(/multiple runtime/i);
    expect(() => buildEvidenceMetadata({ ...base, agentModel: "openai/gpt-5.4" })).toThrow(
      /expected openai/i,
    );
  });

  it("blocks JSONL status totals that disagree with the summary", () => {
    const rows = (base.resultRows.at(0) ?? []).map((row, index) =>
      index === 0 ? { ...row, status: "waiting" } : row,
    );
    expect(buildEvidenceMetadata({ ...base, resultRows: [rows] }).clean).toBe(false);
  });

  it("blocks duplicate or missing eval IDs across the three machine records", () => {
    const firstReport = base.reports[0];
    if (!firstReport) throw new Error("Expected a base report.");
    const duplicateSummary = structuredClone(firstReport);
    const duplicateEval = duplicateSummary.evals[1];
    if (!duplicateEval) throw new Error("Expected a second eval.");
    duplicateEval.id = "eval-0";
    expect(buildEvidenceMetadata({ ...base, reports: [duplicateSummary] }).clean).toBe(false);

    const missingRow = (base.resultRows[0] ?? []).slice(0, -1);
    expect(buildEvidenceMetadata({ ...base, resultRows: [missingRow] }).clean).toBe(false);

    const missingJUnit = base.junit.ids.slice(0, -1);
    expect(
      buildEvidenceMetadata({ ...base, junit: { ...base.junit, ids: missingJUnit } }).clean,
    ).toBe(false);
  });
});
