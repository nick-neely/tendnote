import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("Fallow CI coverage contract (#193)", () => {
  it("produces one merged coverage map for every tested workspace", () => {
    const rootPackage = JSON.parse(read("package.json"));
    const collector = read("scripts/collect-test-coverage.mjs");

    expect(rootPackage.scripts["coverage:ci"]).toBe("node scripts/collect-test-coverage.mjs");
    expect(rootPackage.devDependencies).toHaveProperty("@vitest/coverage-v8");
    expect(rootPackage.devDependencies).not.toHaveProperty("@vitest/coverage-istanbul");
    expect(rootPackage.devDependencies).toHaveProperty("istanbul-lib-coverage");
    expect(collector).toContain('"packages/auth"');
    expect(collector).toContain('"packages/rate-limit"');
    expect(collector).toContain('"apps/agent"');
    expect(collector).toContain('"apps/web"');
    expect(collector).toContain('"packages/db"');
    expect(collector).toContain('"packages/domain"');
    expect(collector).toContain("--coverage.provider=v8");
    expect(collector).toContain("normalizeCoverageCounts");
    expect(collector).toContain("coverage-final.json");
    expect(collector).toContain('["exec", "vitest", "run", "scripts"]');
  });

  it("collects workspaces sequentially so CI resource contention cannot destabilize DOM tests", () => {
    const collector = read("scripts/collect-test-coverage.mjs");

    expect(collector).not.toContain("Promise.all(workspaces.map(collectWorkspace))");
    expect(collector).toContain("reports.push(await collectWorkspace(workspace))");
  });

  it("proves exact covered and uncovered CRAP behavior before the audit", () => {
    const rootPackage = JSON.parse(read("package.json"));
    const workflow = read(".github/workflows/reusable-verify.yml");

    expect(rootPackage.scripts["fallow:ci"]).toContain("--coverage coverage/coverage-final.json");
    expect(rootPackage.scripts["fallow:coverage:check"]).toBe(
      "node scripts/assert-fallow-coverage.mjs",
    );
    // The invariant is the order — coverage, then the CRAP-scoring proof, then
    // the audit that consumes both. Comment lines may sit between the steps;
    // another step may not.
    const commentsOrBlanks = String.raw`(?:\s*#[^\n]*)*\s*`;
    expect(workflow).toMatch(
      new RegExp(
        [
          String.raw`- name: Run tests with coverage\s+if: \$\{\{ inputs\.run_tests \}\}\s+run: pnpm coverage:ci`,
          String.raw`- name: Confirm exact CRAP scoring\s+if: \$\{\{ inputs\.run_tests \}\}\s+run: pnpm fallow:coverage:check`,
          // No escapes in this one, so no `String.raw` - it is the same source.
          `- name: Run Fallow audit`,
        ].join(commentsOrBlanks),
      ),
    );
    expect(workflow).not.toMatch(/\n {2}test:\n/);
    expect(workflow).not.toMatch(/\n {2}build:\n/);
  });
});
