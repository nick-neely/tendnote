import { execFileSync } from "node:child_process";
import { fullSha, isRecord, text } from "./contract.mjs";
import { composeQualificationReport } from "./normalization.mjs";
import { readInput, writeOutput } from "./report-output.mjs";

/**
 * The command line refuses to compose a report for anything other than the
 * commit that is actually checked out, and refuses an input file that names a
 * different candidate. A report is only meaningful for one exact tree.
 */

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  return "Usage: publication-qualification.mjs [--candidate-sha <full-sha>] [--input <gate-results.json>] [--output <report.json>]";
}

function gitOutput(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveCandidate() {
  const candidateSha = argument("--candidate-sha") || gitOutput("rev-parse", "HEAD");
  if (!fullSha(candidateSha))
    throw new Error(`${usage()}\nCandidate must be a full lowercase commit SHA.`);
  const actual = gitOutput("rev-parse", "HEAD");
  if (actual !== candidateSha)
    throw new Error(`Checked out ${actual}, not requested candidate ${candidateSha}.`);
  return candidateSha;
}

function resolveInput(candidateSha) {
  const inputPath = argument("--input");
  const inputValue = inputPath ? readInput(inputPath) : { candidateSha, gates: {} };
  const input = isRecord(inputValue) ? inputValue : {};
  if (text(input.candidateSha) && input.candidateSha !== candidateSha)
    throw new Error(`Input names ${input.candidateSha}, not candidate ${candidateSha}.`);
  if (text(input.candidate?.commit) && input.candidate.commit !== candidateSha)
    throw new Error(
      `Input candidate.commit names ${input.candidate.commit}, not candidate ${candidateSha}.`,
    );
  return input;
}

export function main() {
  const candidateSha = resolveCandidate();
  const repoRoot = gitOutput("rev-parse", "--show-toplevel");
  const input = resolveInput(candidateSha);
  const report = composeQualificationReport({ ...input, candidateSha });
  const outputPath = argument("--output");
  if (outputPath) writeOutput(repoRoot, outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.result.status === "qualified" ? 0 : 1;
}
