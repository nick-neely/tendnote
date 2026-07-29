import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const coveragePath = join(repoRoot, "coverage", "coverage-final.json");
const healthPath = join(repoRoot, "coverage", "fallow-health.json");
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "fallow",
    "health",
    "--coverage",
    coveragePath,
    "--format",
    "json",
    "--output-file",
    healthPath,
    "--no-cache",
  ],
  { cwd: repoRoot, encoding: "utf8" },
);

// Advisory health exits 1 when it finds risks. Exit 2+ means analysis itself failed.
if (result.status !== 0 && result.status !== 1) {
  throw new Error(`Fallow health failed (${result.status}): ${result.stderr || result.stdout}`);
}

const report = JSON.parse(await readFile(healthPath, "utf8"));
const exactFindings = report.findings.filter((finding) => finding.coverage_source === "istanbul");
// Proof that real coverage reached the CRAP math: a covered function must score below
// `c^2 + c`, the value CRAP assigns when coverage is 0. Reference-based estimates cannot
// land under that bound, so any hit here means the exact coverage map was genuinely applied.
//
// Deliberately keyed on "covered at all" rather than a high-coverage witness: the repo is
// not required to keep a *complex* function well covered, and demanding one made this canary
// fail as soon as the tangled functions that happened to satisfy it were decomposed
// (`applyContactImportCandidates`, `buildCandidate`). Reducing complexity must never break
// the check that proves coverage is wired up.
const coveredRelief = exactFindings.find(
  (finding) =>
    finding.coverage_pct > 0 &&
    finding.cyclomatic >= 6 &&
    finding.crap < finding.cyclomatic ** 2 + finding.cyclomatic,
);
const uncoveredRisk = exactFindings.find(
  (finding) => finding.coverage_pct === 0 && finding.cyclomatic >= 6 && finding.crap >= 30,
);

if (!coveredRelief || !uncoveredRisk) {
  throw new Error(
    "Expected exact coverage to reduce a covered function's CRAP score and preserve an uncovered complex function above the gate",
  );
}

console.log(
  `Exact CRAP confirmed: ${coveredRelief.path}:${coveredRelief.line} is ${coveredRelief.coverage_pct.toFixed(1)}% covered (CRAP ${coveredRelief.crap}); ${uncoveredRisk.path}:${uncoveredRisk.line} is uncovered (CRAP ${uncoveredRisk.crap}).`,
);
