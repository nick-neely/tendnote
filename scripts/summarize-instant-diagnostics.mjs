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
 * ## Two audiences, two formats
 *
 * The default output is the Markdown table a reviewer reads, and CI appends it
 * to the step summary. `--format=margins` emits the same rows as one JSON object
 * per line, prefixed so they can be found in a job log with `grep`.
 *
 * Both exist because of #331: the step summary is not retrievable through the
 * API, and the harness only ever *reported* a measurement when it breached — so a
 * passing run revealed nothing about how much headroom it had, and there was no
 * way to tell "passed at 40 ms" from "passed at 99 ms" until the day it passed at
 * 104 ms. Margins are therefore published on every run, green or red, in a form
 * that survives in the log.
 *
 * Usage: node scripts/summarize-instant-diagnostics.mjs [path-to-jsonl] [--format=margins]
 */

const repoRoot = join(import.meta.dirname, "..");
const defaultPath = join(repoRoot, "apps/web/.instant/diagnostics.jsonl");
const args = process.argv.slice(2);
const format =
  args.find((arg) => arg.startsWith("--format="))?.slice("--format=".length) ?? "table";
const path = args.find((arg) => !arg.startsWith("--")) ?? defaultPath;

if (format !== "table" && format !== "margins") {
  console.error(`Unknown --format=${format}. Use "table" or "margins".`);
  process.exit(2);
}

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
      frame: median(
        samples.map((s) => s.frameIntervalMs).filter((value) => typeof value === "number"),
      ),
      // One budget per group by construction: it is a property of the scenario,
      // not of the sample. `first` rather than a median, so a run recorded under
      // one budget is never reported against an average of two.
      shellBudget: first(samples, "shellBudgetMs"),
      completeBudget: first(samples, "completeBudgetMs"),
    };
  })
  .map((row) => ({
    ...row,
    // What #331 asked for by name: how much headroom this row had, on a run that
    // passed. The gated statistic is the median, so the margin is measured from
    // the same one the gate reads.
    shellMarginMs: margin(row.shellBudget, row.shell),
    ackMarginMs: margin(row.shellBudget, row.ack),
    completeMarginMs: margin(row.completeBudget, row.complete),
  }))
  .sort((a, b) => a.project.localeCompare(b.project) || a.scenario.localeCompare(b.scenario));

/** The one value a group agrees on, or null when the group carries none. */
function first(samples, key) {
  const found = samples.find((sample) => typeof sample[key] === "number");
  return found ? found[key] : null;
}

/** Headroom against a budget: positive is inside it, negative is a breach. */
function margin(budget, measured) {
  if (budget === null || measured === null) return null;
  return budget - measured;
}

const ms = (value) => (value === null ? "—" : `${Math.round(value)} ms`);
const signedMs = (value) =>
  value === null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value))} ms`;
const kib = (value) => (value === null ? "—" : `${Math.round(value / 1024)} KiB`);

if (format === "margins") {
  reportMargins();
  process.exit(0);
}

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

// "Margin" is headroom against the 100 ms contract, on the stage that contract
// gates: the truthful shell for a navigation row, the optimistic acknowledgement
// for a mutation row. Both are `shellMs`, which is why one column serves both.
// Every other margin is in the `--format=margins` output.
console.log(
  "| Project | Scenario | Cache | Samples | Ack | Shell | Margin | Frame | DOM stable | Complete | CLS | RSC | Requests | Script |",
);
console.log(
  "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
);
for (const row of rows) {
  console.log(
    `| ${row.project} | ${row.scenario} | ${row.temperature} | ${row.samples} | ${ms(row.ack)} | ${ms(
      row.shell,
    )} | ${signedMs(row.shellMarginMs)} | ${ms(row.frame)} | ${ms(row.stable)} | ${ms(
      row.complete,
    )} | ${row.cls === null ? "—" : row.cls.toFixed(4)} | ${row.rsc ?? "—"} | ${
      row.requests ?? "—"
    } | ${kib(row.scriptKiB)} |`,
  );
}

/**
 * The same rows, one JSON object per line, prefixed so a job log can be grepped.
 *
 * A fixed prefix rather than bare JSON because this shares the log with
 * Playwright's own output; `grep INSTANT_MARGIN` over an archived run's log is
 * the whole point, and it has to work without knowing which lines are ours.
 */
function reportMargins() {
  for (const row of rows) {
    console.log(
      `INSTANT_MARGIN ${JSON.stringify({
        project: row.project,
        scenario: row.scenario,
        temperature: row.temperature,
        samples: row.samples,
        ackMs: round(row.ack),
        shellMs: round(row.shell),
        completeMs: round(row.complete),
        frameIntervalMs: round(row.frame),
        shellBudgetMs: row.shellBudget,
        completeBudgetMs: row.completeBudget,
        ackMarginMs: round(row.ackMarginMs),
        shellMarginMs: round(row.shellMarginMs),
        completeMarginMs: round(row.completeMarginMs),
      })}`,
    );
  }
}

function round(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}
