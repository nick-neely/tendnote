import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import istanbulCoverage from "istanbul-lib-coverage";

const { createCoverageMap } = istanbulCoverage;

const repoRoot = resolve(import.meta.dirname, "..");
const coverageRoot = join(repoRoot, "coverage");
const workspaces = [
  { directory: "apps/agent", include: ["agent/**/*.ts", "scripts/**/*.mjs"] },
  { directory: "apps/web", include: ["src/**/*.{ts,tsx}"] },
  { directory: "packages/db", include: ["src/**/*.ts"] },
  { directory: "packages/domain", include: ["src/**/*.ts"] },
];

function collectWorkspace({ directory, include }) {
  const reportDirectory = join(coverageRoot, directory.replaceAll("/", "-"));
  const args = [
    "--dir",
    join(repoRoot, directory),
    "exec",
    "vitest",
    "run",
    "--coverage.enabled",
    "--coverage.provider=istanbul",
    "--coverage.reporter=json",
    `--coverage.reportsDirectory=${reportDirectory}`,
    ...include.map((pattern) => `--coverage.include=${pattern}`),
  ];

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("pnpm", args, { cwd: repoRoot, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun(join(reportDirectory, "coverage-final.json"));
        return;
      }
      rejectRun(
        new Error(
          `${directory} coverage failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

await rm(coverageRoot, { recursive: true, force: true });
await mkdir(coverageRoot, { recursive: true });

const reports = await Promise.all(workspaces.map(collectWorkspace));
const merged = createCoverageMap({});
for (const report of reports) {
  merged.merge(JSON.parse(await readFile(report, "utf8")));
}

await writeFile(join(coverageRoot, "coverage-final.json"), JSON.stringify(merged.toJSON()));
