import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("Fallow CI coverage contract (#193)", () => {
  it("produces one Istanbul coverage map for every tested workspace", () => {
    const rootPackage = JSON.parse(read("package.json"));
    const collector = read("scripts/collect-test-coverage.mjs");

    expect(rootPackage.scripts["coverage:ci"]).toBe("node scripts/collect-test-coverage.mjs");
    expect(rootPackage.devDependencies).toHaveProperty("@vitest/coverage-istanbul");
    expect(rootPackage.devDependencies).toHaveProperty("istanbul-lib-coverage");
    expect(collector).toContain('"packages/auth"');
    expect(collector).toContain('"packages/rate-limit"');
    expect(collector).toContain('"apps/agent"');
    expect(collector).toContain('"apps/web"');
    expect(collector).toContain('"packages/db"');
    expect(collector).toContain('"packages/domain"');
    expect(collector).toContain("--coverage.provider=istanbul");
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
    expect(workflow).toMatch(
      /- name: Run tests with coverage\s+run: pnpm coverage:ci\s+\n?\s*- name: Confirm exact CRAP scoring\s+run: pnpm fallow:coverage:check\s+\n?\s*- name: Run Fallow audit/,
    );
    expect(workflow).not.toMatch(/\n {2}test:\n/);
    expect(workflow).not.toMatch(/\n {2}build:\n/);
  });
});
