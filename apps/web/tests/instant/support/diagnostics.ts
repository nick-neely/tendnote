import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { instantArtifactDir } from "./rig";

/**
 * Recorded diagnostics, not gates.
 *
 * ADR 0210 keeps query time, RSC and client payloads, request fan-out, server
 * work, and mutation latency as *reviewed diagnostics* until repeatable
 * post-upgrade distributions justify stable thresholds. Failing a pull request
 * on a number whose distribution nobody has seen yet produces flakes and then
 * disabled tests, which is worse than no gate. So every measurement lands here
 * as a line of JSON, and the hard budgets stay in `measure.ts`.
 */

export type DiagnosticRecord = {
  scenario: string;
  project: string;
  /** Cold = first visit to this destination in the context; warm = a repeat. */
  temperature: "cold" | "warm";
  acknowledgementMs: number | null;
  shellMs: number;
  completeMs: number;
  /** Baseline-comparable "DOM stable" reading; see `StageTiming.stable`. */
  stableMs: number;
  cumulativeLayoutShift: number;
  /** RSC responses observed between the click and settled content. */
  rscResponses: number;
  /** Bytes transferred by those RSC responses. */
  rscBytes: number;
  /** Script bytes transferred on a cold direct load, when measured. */
  scriptBytes?: number;
  /** Total requests observed in the click window: ADR 0210's request fan-out. */
  requestFanOut: number;
};

const FILE = "diagnostics.jsonl";

export function recordDiagnostic(record: DiagnosticRecord) {
  const dir = instantArtifactDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, FILE), `${JSON.stringify(record)}\n`);
}

export const UNCOVERED_ENGINES_FILE = "uncovered-engines.jsonl";

/**
 * Record that a project executed no specs, and why.
 *
 * Its own file rather than a `DiagnosticRecord` with null timings: this is not a
 * measurement, it is the absence of one, and the summariser reads it *before*
 * the table so a reviewer meets the gap before the numbers. Written per skipped
 * test and de-duplicated by project on read. `global-setup.ts` truncates it, so
 * a stale line cannot claim an engine was uncovered on a run where it ran.
 */
export function recordUncoveredEngine(project: string, reason: string) {
  const dir = instantArtifactDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, UNCOVERED_ENGINES_FILE), `${JSON.stringify({ project, reason })}\n`);
}
