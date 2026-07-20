import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import istanbulCoverage from "istanbul-lib-coverage";

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
      "--coverage.provider=istanbul",
      "--coverage.reporter=json",
      `--coverage.reportsDirectory=${reportDirectory}`,
      ...include.map((pattern) => `--coverage.include=${pattern}`),
    ],
    `${directory} coverage`,
  );
  return join(reportDirectory, "coverage-final.json");
}

await rm(coverageRoot, { recursive: true, force: true });
await mkdir(coverageRoot, { recursive: true });

// The root contract test validates this collector and the workflow that calls
// it. It is intentionally outside the Istanbul map because it checks CI wiring
// rather than product functions scored by Fallow.
await runPnpm(["exec", "vitest", "run", "scripts"], "root script tests");

const reports = [];
for (const workspace of workspaces) {
  reports.push(await collectWorkspace(workspace));
}
const merged = createCoverageMap({});
for (const report of reports) {
  merged.merge(JSON.parse(await readFile(report, "utf8")));
}

await writeFile(join(coverageRoot, "coverage-final.json"), JSON.stringify(merged.toJSON()));
