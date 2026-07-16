import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PASS_VERDICTS = new Set(["passed", "skipped"]);
const RETRY_ROUNDS = 2;

function samplePassed(result) {
  return Boolean(result && !result.error && PASS_VERDICTS.has(result.verdict));
}

export function failingEvalIds(summary) {
  return summary.results.filter((result) => !samplePassed(result)).map((result) => result.id);
}

export function buildRetryDecision(samples) {
  const passCount = samples.filter(Boolean).length;
  return { passed: passCount >= (samples.length === 1 ? 1 : 2), passCount };
}

export function summarizeEvalSamples(samplesById) {
  let passed = 0;
  let recovered = 0;
  const failedIds = [];
  for (const [id, samples] of samplesById) {
    const decision = buildRetryDecision(samples);
    if (decision.passed) {
      passed += 1;
      if (samples.length > 1 && samples[0] === false) recovered += 1;
    } else {
      failedIds.push(id);
    }
  }
  return { passed, failed: failedIds.length, recovered, failedIds };
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
    return parseJsonOutput(result.stdout);
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

function writeJunit(filePath, samplesById) {
  const summary = summarizeEvalSamples(samplesById);
  const cases = [...samplesById].map(([id, samples]) => {
    const decision = buildRetryDecision(samples);
    const detail = `${decision.passCount}/${samples.length} samples passed`;
    const failure = decision.passed
      ? ""
      : `<failure message="${xmlEscape(detail)}">${xmlEscape(
          `Required two passing samples after an initial failure; observed ${detail}.`,
        )}</failure>`;
    return `<testcase classname="eve.deterministic-grading" name="${xmlEscape(id)}">${failure}</testcase>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Eve deterministic grading" tests="${samplesById.size}" failures="${summary.failed}">\n${cases.join("\n")}\n</testsuite>\n`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, xml);
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function main() {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const junitPath = resolve(cwd, optionValue("--junit") ?? ".eve/evals/junit.xml");
  const initial = runEveEval(cwd);
  const samplesById = new Map(initial.results.map((result) => [result.id, [samplePassed(result)]]));
  const retryIds = failingEvalIds(initial);

  for (let round = 1; round <= RETRY_ROUNDS && retryIds.length > 0; round += 1) {
    process.stdout.write(
      `Retry sample ${round}/${RETRY_ROUNDS} for ${retryIds.length} failing eval${retryIds.length === 1 ? "" : "s"}.\n`,
    );
    prepareEvalDatabase(cwd);
    const retry = runEveEval(cwd, retryIds);
    for (const id of retryIds) {
      const result = retry.results.find((candidate) => candidate.id === id);
      samplesById.get(id)?.push(samplePassed(result));
    }
  }

  writeJunit(junitPath, samplesById);
  const summary = summarizeEvalSamples(samplesById);
  process.stdout.write(
    `Deterministic grading: ${summary.passed} passed, ${summary.failed} failed, ${summary.recovered} recovered by sampling.\n`,
  );
  if (summary.failed > 0) {
    process.stderr.write(`Persistent eval failures: ${summary.failedIds.join(", ")}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
