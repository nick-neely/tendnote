#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Summarise one Instant matrix run into the table that goes in the verification
 * record.
 *
 * ADR 0210 compares *medians* against the recorded 16.2 baseline, so the raw
 * per-sample JSONL the harness writes is not the reviewable artifact — this is.
 * Kept as a separate step rather than a reporter so a run's numbers can be
 * re-summarised without re-running the browser.
 *
 * Usage: node scripts/summarize-instant-diagnostics.mjs [path-to-jsonl]
 */

const repoRoot = join(import.meta.dirname, "..");
const defaultPath = join(repoRoot, "apps/web/.instant/diagnostics.jsonl");
const path = process.argv[2] ?? defaultPath;

const records = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// Keyed by a JSON tuple rather than a delimited string: scenario names contain
// spaces and punctuation, so any single-character separator is one fixture
// rename away from splitting a group in half — and the NUL this used to use
// made git treat the whole file as binary.
const groups = new Map();
for (const record of records) {
  const key = JSON.stringify([record.project, record.scenario, record.temperature]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(record);
}

const rows = [...groups.entries()]
  .map(([key, samples]) => {
    const [project, scenario, temperature] = JSON.parse(key);
    return {
      project,
      scenario,
      temperature,
      samples: samples.length,
      ack: median(samples.map((s) => s.acknowledgementMs).filter((v) => v !== null)),
      shell: median(samples.map((s) => s.shellMs)),
      stable: median(samples.map((s) => s.stableMs)),
      complete: median(samples.map((s) => s.completeMs)),
      cls: median(samples.map((s) => s.cumulativeLayoutShift)),
      rsc: median(samples.map((s) => s.rscResponses)),
      requests: median(samples.map((s) => s.requestFanOut)),
      scriptKiB: median(
        samples.map((s) => s.scriptBytes).filter((value) => typeof value === "number"),
      ),
    };
  })
  .sort((a, b) => a.project.localeCompare(b.project) || a.scenario.localeCompare(b.scenario));

const ms = (value) => (value === null ? "—" : `${Math.round(value)} ms`);
const kib = (value) => (value === null ? "—" : `${Math.round(value / 1024)} KiB`);

reportUncoveredEngines();

/**
 * Name every engine that executed no specs, with the reason it did not.
 *
 * The diagnostics table below only has rows for engines that *ran*, and an
 * absent row is indistinguishable from an engine nobody thought to configure.
 * The case that matters is the opposite one — a green `Promotion verify` must
 * not be readable as evidence about an engine that never executed a single
 * spec — so it is stated above the table rather than inferred from a gap in it.
 * The harness writes the file as it skips; see
 * `apps/web/tests/instant/support/engine-support.ts`.
 */
function reportUncoveredEngines() {
  // A *sibling* of the diagnostics file being summarised, not a fixed path.
  // Both are artifacts of one run, so re-summarising an archived run must read
  // that run's coverage — anchoring this to the repository would caption an
  // archived table with whichever engines the *latest* run happened to skip.
  const reasons = readUncoveredEngines(join(dirname(path), "uncovered-engines.jsonl"));
  if (reasons.size === 0) return;

  console.log("### Engines NOT covered by this run\n");
  for (const [project, reason] of reasons) {
    console.log(`- **${project}** — no spec executed. ${reason}`);
  }
  console.log("");
}

/** One reason per project, last write winning; the harness appends per skip. */
function readUncoveredEngines(path) {
  const reasons = new Map();
  if (!existsSync(path)) return reasons;

  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const record = JSON.parse(line);
    reasons.set(record.project, record.reason);
  }

  return reasons;
}

console.log(
  "| Project | Scenario | Cache | Samples | Ack | Shell | DOM stable | Complete | CLS | RSC | Requests | Script |",
);
console.log("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const row of rows) {
  console.log(
    `| ${row.project} | ${row.scenario} | ${row.temperature} | ${row.samples} | ${ms(row.ack)} | ${ms(
      row.shell,
    )} | ${ms(row.stable)} | ${ms(row.complete)} | ${row.cls === null ? "—" : row.cls.toFixed(4)} | ${
      row.rsc ?? "—"
    } | ${row.requests ?? "—"} | ${kib(row.scriptKiB)} |`,
  );
}
