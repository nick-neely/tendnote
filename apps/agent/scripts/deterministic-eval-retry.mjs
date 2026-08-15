import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The deterministic grading wrapper: run the tag, resample what failed, and
 * report the difference between "passed" and "passed eventually".
 *
 * ## What counts as a pass
 *
 * Only `passed`. `skipped` used to sit in this set beside it, which meant an
 * eval that called `t.skip(reason)` - or a whole tag that skipped itself for a
 * missing precondition - was counted in the passing tally and reported as green.
 * A skip is not a pass and it is not a failure either, so it is tracked and
 * printed as its own thing and never retried: resampling an intentional skip
 * only produces the same skip.
 *
 * ## What a retry may and may not launder
 *
 * A retry can recover ONE failure - the first sample - and only if every retry
 * sample after it passes. That much is worth having: these evals drive a live
 * model, and a single sampling wobble should not fail a build on its own.
 *
 * What it must not do is disappear. The old policy scored "2 of 3 samples" as a
 * plain pass, so an eval failing a third of the time was indistinguishable in
 * the output from one that has never failed, and `summary.recovered` was printed
 * into a line nothing consumed. A recovery is now a distinct, non-zero outcome:
 * `EXIT_FLAKY` from the process, a `<flakyFailure>` on the JUnit case, and the
 * ids named on stderr. The workflow runs this as its one graded step and uploads
 * `.eve/evals/` afterwards, so a non-zero exit is exactly what puts the evidence
 * in front of someone.
 *
 * ## What "nothing failed" is not
 *
 * A skip is neither a pass nor a failure, which leaves one run where that is not
 * enough: the one where *everything* skipped. Nothing failed and nothing was
 * recovered, so the exit code was 0 and the lane reported green having graded no
 * behavior at all - the exact outcome a missing precondition, an unseeded eval
 * database, or a tag nothing matches produces. A run that graded nothing gets its
 * own non-zero code instead.
 *
 * Exit codes, which are the contract with `.github/workflows/eve-evals.yml`:
 * 0 = every eval passed on its first sample; 1 = at least one eval failed every
 * sample; 3 = no persistent failures, but at least one eval only passed on retry;
 * 4 = nothing was graded, so the run proves nothing.
 */

const PASS_VERDICTS = new Set(["passed"]);
const SKIP_VERDICTS = new Set(["skipped"]);
const RETRY_ROUNDS = 2;

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_FLAKY = 3;
export const EXIT_NOTHING_GRADED = 4;

const USAGE = `Usage: node scripts/deterministic-eval-retry.mjs [--junit <path>]

Runs \`eve eval --tag deterministic\`, resamples each failing eval ${RETRY_ROUNDS} more times
against a freshly prepared database, and writes a JUnit report.

  --junit <path>  JUnit output path (default: .eve/evals/junit.xml)
  --help          Print this and exit without running anything.

Exit codes: ${EXIT_OK} clean, ${EXIT_FAILED} persistent failure, ${EXIT_FLAKY} recovered by retry (flaky), ${EXIT_NOTHING_GRADED} nothing graded.
`;

/** How one recorded eval result landed. A skip is neither a pass nor a failure. */
export function sampleOutcome(result) {
  if (!result || result.error) return "failed";
  if (SKIP_VERDICTS.has(result.verdict)) return "skipped";
  return PASS_VERDICTS.has(result.verdict) ? "passed" : "failed";
}

export function failingEvalIds(summary) {
  return summary.results
    .filter((result) => sampleOutcome(result) === "failed")
    .map((result) => result.id);
}

export function skippedEvalIds(summary) {
  return summary.results
    .filter((result) => sampleOutcome(result) === "skipped")
    .map((result) => result.id);
}

/**
 * Whether an eval's samples clear the gate, and at what cost.
 *
 * `clean` and `recovered` are kept apart on purpose: both let the suite
 * continue, and only one of them is something to leave unmentioned.
 */
export function buildRetryDecision(samples) {
  const passCount = samples.filter(Boolean).length;
  const clean = samples.length > 0 && passCount === samples.length;
  const recovered =
    !clean && samples.length > 1 && samples[0] === false && samples.slice(1).every(Boolean);

  return { passed: clean || recovered, clean, recovered, passCount };
}

export function summarizeEvalSamples(samplesById, skippedIds = []) {
  let passed = 0;
  const failedIds = [];
  const recoveredIds = [];
  for (const [id, samples] of samplesById) {
    const decision = buildRetryDecision(samples);
    if (!decision.passed) {
      failedIds.push(id);
      continue;
    }
    passed += 1;
    if (decision.recovered) recoveredIds.push(id);
  }

  return {
    passed,
    failed: failedIds.length,
    recovered: recoveredIds.length,
    skipped: skippedIds.length,
    failedIds,
    recoveredIds,
    skippedIds: [...skippedIds],
  };
}

/** The process exit code one summary earns. Flake is reported, never absorbed. */
export function exitCodeFor(summary) {
  if (summary.failed > 0) return EXIT_FAILED;
  // Everything skipped: nothing failed, nothing passed, nothing was proven. Zero
  // here is how a lane that graded no behavior at all reports as a green gate.
  if (summary.passed === 0 && summary.skipped > 0) return EXIT_NOTHING_GRADED;
  return summary.recovered > 0 ? EXIT_FLAKY : EXIT_OK;
}

/**
 * The child's report, only when it is actually one.
 *
 * `eve eval --strict` exits non-zero for an ordinary failing eval, so a non-zero
 * status is not an error here - grading those failures is what this script is for.
 * What is an error is a run that never finished reporting: killed by a signal, or
 * a summary that parsed but carries no gradable results. The parser takes the first
 * line that starts with `{` and JSON.parse would accept a complete-looking object
 * from a truncated stream, and a summary with no results grades green through every
 * tally below - so the shape is checked here rather than assumed.
 */
export function assertGradableSummary(summary, child) {
  if (child?.signal) {
    throw new Error(`Eve eval was terminated by ${child.signal} before it reported.`);
  }
  if (typeof child?.status !== "number") {
    throw new Error("Eve eval did not exit normally, so its summary cannot be graded.");
  }
  if (!summary || typeof summary !== "object" || !Array.isArray(summary.results)) {
    throw new Error("Eve eval did not produce a gradable summary: no `results` array.");
  }
  if (summary.results.length === 0) {
    throw new Error("Eve eval reported no evals at all; there is nothing to grade.");
  }
  for (const result of summary.results) {
    if (!result || typeof result.id !== "string" || result.id.length === 0) {
      throw new Error("Eve eval reported a result with no id; the summary is not complete.");
    }
  }
  return summary;
}

function parseJsonOutput(stdout) {
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimStart().startsWith("{"));
  if (start < 0) throw new Error("Eve did not produce a JSON eval summary.");
  return JSON.parse(lines.slice(start).join("\n"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  return result;
}

function runEveEval(cwd, ids = []) {
  const args = ["exec", "eve", "eval"];
  if (ids.length > 0) args.push(...ids);
  else args.push("--tag", "deterministic");
  args.push("--strict", "--skip-report", "--json");
  const result = run("pnpm", args, { cwd });
  try {
    return assertGradableSummary(parseJsonOutput(result.stdout), result);
  } catch (error) {
    if (result.stdout) process.stdout.write(result.stdout);
    throw error;
  }
}

function prepareEvalDatabase(cwd) {
  const result = run("pnpm", ["eval:prepare"], { cwd });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error("Could not prepare the deterministic eval database.");
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** The body of one JUnit case: nothing, a failure, a flaky recovery, or a skip. */
function junitCaseBody(samples) {
  const decision = buildRetryDecision(samples);
  const detail = `${decision.passCount}/${samples.length} samples passed`;
  if (decision.clean) return "";
  if (decision.recovered) {
    return `<flakyFailure message="${xmlEscape(detail)}">${xmlEscape(
      `Failed its first sample and passed every retry (${detail}). Recovered, not clean.`,
    )}</flakyFailure>`;
  }
  return `<failure message="${xmlEscape(detail)}">${xmlEscape(
    `Required every retry sample to pass after an initial failure; observed ${detail}.`,
  )}</failure>`;
}

function writeJunit(filePath, samplesById, skippedIds) {
  const summary = summarizeEvalSamples(samplesById, skippedIds);
  const cases = [...samplesById].map(
    ([id, samples]) =>
      `<testcase classname="eve.deterministic-grading" name="${xmlEscape(id)}">${junitCaseBody(samples)}</testcase>`,
  );
  for (const id of skippedIds) {
    cases.push(
      `<testcase classname="eve.deterministic-grading" name="${xmlEscape(id)}"><skipped message="The eval skipped itself; it was not run and is not a pass."/></testcase>`,
    );
  }
  const total = samplesById.size + skippedIds.length;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Eve deterministic grading" tests="${total}" failures="${summary.failed}" skipped="${summary.skipped}">\n${cases.join("\n")}\n</testsuite>\n`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, xml);
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }

  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const junitPath = resolve(cwd, optionValue("--junit") ?? ".eve/evals/junit.xml");
  const initial = runEveEval(cwd);
  const skippedIds = skippedEvalIds(initial);
  const skipped = new Set(skippedIds);
  const samplesById = new Map(
    initial.results
      .filter((result) => !skipped.has(result.id))
      .map((result) => [result.id, [sampleOutcome(result) === "passed"]]),
  );
  const retryIds = failingEvalIds(initial);

  for (let round = 1; round <= RETRY_ROUNDS && retryIds.length > 0; round += 1) {
    process.stdout.write(
      `Retry sample ${round}/${RETRY_ROUNDS} for ${retryIds.length} failing eval${retryIds.length === 1 ? "" : "s"}.\n`,
    );
    prepareEvalDatabase(cwd);
    const retry = runEveEval(cwd, retryIds);
    for (const id of retryIds) {
      const result = retry.results.find((candidate) => candidate.id === id);
      samplesById.get(id)?.push(sampleOutcome(result) === "passed");
    }
  }

  writeJunit(junitPath, samplesById, skippedIds);
  const summary = summarizeEvalSamples(samplesById, skippedIds);
  process.stdout.write(
    `Deterministic grading: ${summary.passed} passed (${summary.recovered} only after retry), ${summary.failed} failed, ${summary.skipped} skipped.\n`,
  );
  if (summary.failed > 0) {
    process.stderr.write(`Persistent eval failures: ${summary.failedIds.join(", ")}\n`);
  }
  if (summary.recovered > 0) {
    process.stderr.write(
      `FLAKY: these evals failed a sample and only passed on retry: ${summary.recoveredIds.join(", ")}\n` +
        "They are not clean. Fix the eval or the behavior rather than re-running until it is green.\n",
    );
  }
  if (summary.skipped > 0) {
    process.stderr.write(`Skipped (not run, not passed): ${summary.skippedIds.join(", ")}\n`);
  }
  process.exitCode = exitCodeFor(summary);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
