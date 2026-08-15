export type EvalResult = {
  id: string;
  verdict: string;
  error?: unknown;
};

export type EvalSampleOutcome = "passed" | "failed" | "skipped";

export type RetryDecision = {
  passed: boolean;
  /** Every sample passed. */
  clean: boolean;
  /** Failed its first sample and passed every retry: allowed through, reported as flaky. */
  recovered: boolean;
  passCount: number;
};

export type EvalRunSummary = {
  passed: number;
  failed: number;
  recovered: number;
  skipped: number;
  failedIds: string[];
  recoveredIds: string[];
  skippedIds: string[];
};

export const EXIT_OK: 0;
export const EXIT_FAILED: 1;
export const EXIT_FLAKY: 3;
/** Nothing was graded: every eval skipped itself, so the run proves nothing. */
export const EXIT_NOTHING_GRADED: 4;

/** The relevant part of a finished `spawnSync` child. */
export type EvalChildProcess = {
  status: number | null;
  signal?: NodeJS.Signals | null;
};

export function sampleOutcome(result: EvalResult | undefined): EvalSampleOutcome;
export function failingEvalIds(summary: { results: EvalResult[] }): string[];
export function skippedEvalIds(summary: { results: EvalResult[] }): string[];
export function buildRetryDecision(samples: boolean[]): RetryDecision;
export function summarizeEvalSamples(
  samplesById: Map<string, boolean[]>,
  skippedIds?: readonly string[],
): EvalRunSummary;
export function exitCodeFor(summary: EvalRunSummary): 0 | 1 | 3 | 4;
export function assertGradableSummary<TSummary>(
  summary: TSummary,
  child: EvalChildProcess,
): TSummary;
export function main(): void;
