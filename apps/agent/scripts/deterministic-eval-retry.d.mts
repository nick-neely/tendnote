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

export function sampleOutcome(result: EvalResult | undefined): EvalSampleOutcome;
export function failingEvalIds(summary: { results: EvalResult[] }): string[];
export function skippedEvalIds(summary: { results: EvalResult[] }): string[];
export function buildRetryDecision(samples: boolean[]): RetryDecision;
export function summarizeEvalSamples(
  samplesById: Map<string, boolean[]>,
  skippedIds?: readonly string[],
): EvalRunSummary;
export function exitCodeFor(summary: EvalRunSummary): 0 | 1 | 3;
export function main(): void;
