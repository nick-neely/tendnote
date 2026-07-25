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
    // hang on GitHub's six-hour default. The budget is tier-aware: the full
    // tier's first run installs three engines from a cold cache before it
    // builds, and that run is the mandatory WebKit evidence.
    expect(job).toMatch(/timeout-minutes: \$\{\{ inputs\.full_browser_matrix && \d+ \|\| 15 \}\}/);
  });

  it("audits Fallow against main rather than the branch's own upstream", () => {
    const job = workflow.slice(
      workflow.indexOf("test_fallow:"),
      workflow.indexOf("instant_matrix:"),
    );
    // Without this the base resolves to the pushed branch itself and the audit
    // reports almost nothing, so the gate passes while blind.
    expect(job).toContain("FALLOW_AUDIT_BASE: origin/main");
    expect(job).toContain("fetch-depth: 0");
  });
});

/**
 * The full promotion tier has to be reachable (#311).
 *
 * ADR 0211 makes the full matrix mandatory for the framework upgrade and the
 * production promotion, and ADR 0210 keeps it off routine pull requests. Those
 * two together only hold if there is exactly one caller that asks for it, on
 * demand, and the pull-request caller never does.
 */
describe("Full promotion browser matrix trigger", () => {
  const promotion = read(".github/workflows/promotion-verify.yml");
  const pullRequest = read(".github/workflows/pr-verify.yml");

  it("is asked for deliberately rather than run by an ordinary event", () => {
    // A three-engine matrix that ran on every push or every pull request would
    // be the tax ADR 0210 exists to avoid. The only `pull_request` activity it
    // answers is a label being applied, and only the right label.
    expect(promotion).not.toMatch(/^\s{2}push:/m);
    expect(promotion).toMatch(
      /pull_request:\s*\n\s*branches:\s*\n\s*- main\s*\n\s*types:\s*\n\s*- labeled\s*\n/,
    );
    expect(promotion).toContain("github.event.label.name == 'full-browser-matrix'");
  });

  it("runs for a dispatch, which carries no label to match on", () => {
    // GitHub only offers `workflow_dispatch` for workflows already on the
    // default branch, so a framework upgrade cannot dispatch its own
    // qualification run — the label trigger exists for that. Both must stay
    // wired: a job condition that only admits the label would leave every
    // dispatch silently skipped, which reads as a green run that did nothing.
    expect(promotion).toContain("workflow_dispatch:");
    expect(promotion).toMatch(/if: github\.event_name == 'workflow_dispatch' \|\|/);
  });

  it("fails the promotion gate rather than reporting a skipped matrix as passing", () => {
    const gate = promotion.slice(promotion.indexOf("  gate:"));
    // `needs.verify` is skipped whenever the wrong label was applied. The gate
    // must skip with it rather than run and report success against a matrix
    // that never executed — and must exit non-zero for any other non-success.
    expect(gate).toContain("needs.verify.result != 'skipped'");
    expect(gate).toMatch(/needs\.verify\.result }}" != "success"[\s\S]*?exit 1/);
  });

  it("requests the full tier from the same reusable verification", () => {
    // One verification definition, one extra input — not a second copy of the
    // pipeline that could drift from the routine one.
    expect(promotion).toContain("uses: ./.github/workflows/reusable-verify.yml");
    expect(promotion).toContain("full_browser_matrix: true");
  });

  it("leaves routine pull-request verification on the Chromium tier", () => {
    expect(pullRequest).toContain("uses: ./.github/workflows/reusable-verify.yml");
    expect(pullRequest).not.toContain("full_browser_matrix");
  });

  it("does not share a concurrency group with pull-request verification", () => {
    // pr-verify keys its group on a pull-request number, which a dispatch does
    // not have; sharing the group would let one cancel the other.
    const group = promotion.match(/group: (.+)/)?.[1];
    expect(group).toBeDefined();
    expect(group).not.toContain("pull_request");
    expect(pullRequest).not.toContain(`group: ${group}`);
  });
});
