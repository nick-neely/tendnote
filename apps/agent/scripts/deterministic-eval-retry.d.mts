export type EvalResult = {
  id: string;
  verdict: string;
  error?: unknown;
};

export function failingEvalIds(summary: { results: EvalResult[] }): string[];
export function buildRetryDecision(samples: boolean[]): { passed: boolean; passCount: number };
export function summarizeEvalSamples(samplesById: Map<string, boolean[]>): {
  passed: number;
  failed: number;
  recovered: number;
  failedIds: string[];
};
export function main(): void;
