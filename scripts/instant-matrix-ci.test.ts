import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

/**
 * The CI shape ADR 0210 requires of the Instant Interaction matrix.
 *
 * These are structural claims a reviewer would otherwise have to re-derive from
 * YAML on every change: that the browser job is parallel rather than bolted onto
 * the serial test job, that the routine tier and the full promotion tier are
 * separate rather than one job with a flag nobody sets, and that the gate
 * actually fails when the matrix fails.
 */
describe("Instant Interaction matrix CI contract", () => {
  const workflow = read(".github/workflows/reusable-verify.yml");

  it("runs the browser matrix as its own parallel job", () => {
    expect(workflow).toContain("instant_matrix:");
    expect(workflow).toContain("name: Instant matrix");
    // Not a step inside Test and Fallow: ADR 0210 requires the browser job to
    // run alongside the existing critical path, not extend it.
    const testFallowJob = workflow.slice(
      workflow.indexOf("test_fallow:"),
      workflow.indexOf("instant_matrix:"),
    );
    expect(testFallowJob).not.toContain("test:instant");
  });

  it("keeps the routine tier separate from the full promotion tier", () => {
    expect(workflow).toContain("full_browser_matrix");
    // Routine pull requests run Chromium only; Firefox and WebKit are installed
    // and exercised only for the upgrade-and-promotion tier, and the two tiers
    // are separate commands rather than one command with a flag nobody sets.
    expect(workflow).toContain("run: pnpm test:instant\n");
    expect(workflow).toContain("run: pnpm test:instant:full\n");
  });

  it("fails verification when the matrix fails", () => {
    const verifyJob = workflow.slice(workflow.indexOf("  verify:"));
    expect(verifyJob).toContain("- instant_matrix");
    expect(verifyJob).toContain("needs.instant_matrix.result");
  });

  it("gives the matrix the database and cache its fixture needs, and a wall clock", () => {
    const job = workflow.slice(workflow.indexOf("instant_matrix:"), workflow.indexOf("  verify:"));
    expect(job).toContain("pgvector/pgvector:pg17");
    expect(job).toContain("redis:");
    // The rollout criterion is a wall-time one, so the job must fail rather than
    // hang on GitHub's six-hour default.
    expect(job).toContain("timeout-minutes: 15");
  });
});
