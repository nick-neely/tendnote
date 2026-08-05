import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import istanbulCoverage from "istanbul-lib-coverage";
import { normalizeCoverageCounts } from "./normalize-coverage-counts.mjs";

const { createCoverageMap } = istanbulCoverage;

const repoRoot = resolve(import.meta.dirname, "..");
const coverageRoot = join(repoRoot, "coverage");
const workspaces = [
  { directory: "packages/auth", include: ["src/**/*.ts"] },
  { directory: "packages/rate-limit", include: ["src/**/*.ts"] },
  { directory: "packages/domain", include: ["src/**/*.ts"] },
  { directory: "packages/db", include: ["src/**/*.ts"] },
  { directory: "apps/agent", include: ["agent/**/*.ts", "scripts/**/*.mjs"] },
  { directory: "apps/web", include: ["src/**/*.{ts,tsx}"] },
];
// The full-coverage job runs on a two-vCPU runner. Two child Vitest processes
// with 50% of the available workers each use both cores without turning the
// collector into a process multiplier. The report paths and merge order remain
// deterministic.
const maxConcurrentWorkspaces = 2;

function runPnpm(args, label) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("pnpm", args, { cwd: repoRoot, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

async function collectWorkspace({ directory, include }) {
  const reportDirectory = join(coverageRoot, directory.replaceAll("/", "-"));
  await runPnpm(
    [
      "--dir",
      join(repoRoot, directory),
      "exec",
      "vitest",
      "run",
      "--passWithNoTests",
      "--coverage.enabled",
      "--coverage.provider=v8",
      "--coverage.reporter=json",
      "--maxWorkers=50%",
      `--coverage.reportsDirectory=${reportDirectory}`,
      ...include.map((pattern) => `--coverage.include=${pattern}`),
    ],
    `${directory} coverage`,
  );
  return join(reportDirectory, "coverage-final.json");
}

async function collectWorkspaces() {
  const reports = new Array(workspaces.length);
  let nextIndex = 0;
  let failed = false;

  function nextWorkspaceIndex() {
    if (nextIndex >= workspaces.length) return undefined;
    const index = nextIndex;
    nextIndex += 1;
    return index;
  }

  async function collectFromQueue() {
    while (!failed) {
      const index = nextWorkspaceIndex();
      if (index === undefined) return;

      try {
        reports[index] = await collectWorkspace(workspaces[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrentWorkspaces, workspaces.length) }, () =>
    collectFromQueue(),
  );
  const results = await Promise.allSettled(workers);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;

  return reports;
}

await rm(coverageRoot, { recursive: true, force: true });
await mkdir(coverageRoot, { recursive: true });

// The root contract test validates this collector and the workflow that calls
// it. It is intentionally outside the merged coverage map because it checks CI wiring
// rather than product functions scored by Fallow.
await runPnpm(["exec", "vitest", "run", "scripts"], "root script tests");

const reports = await collectWorkspaces();
const merged = createCoverageMap({});
for (const report of reports) {
  merged.merge(JSON.parse(await readFile(report, "utf8")));
}

const normalized = normalizeCoverageCounts(merged.toJSON());
if (normalized.normalizedCount > 0) {
  console.warn(
    `Normalized ${normalized.normalizedCount} impossible negative V8 coverage counter(s) to zero.`,
  );
}
await writeFile(join(coverageRoot, "coverage-final.json"), JSON.stringify(normalized.coverage));
