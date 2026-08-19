import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  unsupportedEngineReason,
  WEBKIT_LOOPBACK_SKIP_REASON,
} from "../apps/web/tests/instant/support/engine-support";

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
    const matrixGate = workflow.slice(
      workflow.indexOf("- name: Run the routine Chromium matrix"),
      workflow.indexOf("- name: Summarise recorded diagnostics"),
    );
    const pullRequest = read(".github/workflows/pr-verify.yml");
    const promotion = read(".github/workflows/promotion-verify.yml");

    expect(matrixGate).not.toContain("continue-on-error: true");
    expect(pullRequest).toContain('needs.verify.result }}" != "success"');
    expect(promotion).toContain('needs.verify.result }}" != "success"');
  });

  it("gives the matrix the database and cache its fixture needs, and a wall clock", () => {
    const job = workflow.slice(workflow.indexOf("instant_matrix:"), workflow.indexOf("  verify:"));
    expect(job).toContain("pgvector/pgvector:pg17");
    expect(job).toContain("redis:");
    // The rollout criterion is a wall-time one, so the job must fail rather than
    // hang on GitHub's six-hour default. The budget is tier-aware: the full
    // tier's first run installs three engines from a cold cache before it
    // builds, and that run is the mandatory WebKit evidence.
    const budget = job.match(
      /timeout-minutes: \$\{\{ inputs\.full_browser_matrix && (\d+) \|\| (\d+) \}\}/,
    );
    expect(budget).not.toBeNull();
    // Both numbers move with the runner shape and the cache backend, so the
    // contract asserted here is the ordering rather than either literal.
    const [full, routine] = [Number(budget?.[1]), Number(budget?.[2])];
    expect(full).toBeGreaterThan(routine);
  });

  it("publishes each row's measured margin on every run, not only on breaches", () => {
    const job = workflow.slice(workflow.indexOf("instant_matrix:"), workflow.indexOf("  verify:"));

    // The failure #331 records is one of *evidence*, not of measurement: the
    // harness only reported a timing when it exceeded its budget, and the step
    // summary that holds the rest is not retrievable through the API. So a green
    // run said nothing about how close it came, and the first sign of drift was
    // the breach. Two destinations, deliberately — the summary for a human
    // reading the run, and `INSTANT_MARGIN` lines in the job log for anyone
    // asking the question later.
    expect(job).toContain(
      'node scripts/summarize-instant-diagnostics.mjs >> "$GITHUB_STEP_SUMMARY"',
    );
    expect(job).toContain("run: node scripts/summarize-instant-diagnostics.mjs --format=margins");

    // Traces upload on failure only, which is right for traces and wrong for the
    // distribution: a breach is only readable against the passes around it.
    const upload = job.slice(
      job.indexOf("- name: Upload recorded diagnostics"),
      job.indexOf("- name: Upload failure traces"),
    );
    expect(upload).toContain("if: always()");
    expect(upload).toContain("apps/web/.instant/diagnostics.jsonl");
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

  it("keeps installing WebKit, which the Preview qualification still needs", () => {
    const workflow = read(".github/workflows/reusable-verify.yml");
    // The engine is skipped on the loopback rig, not removed from the tier. A
    // run pointed at an HTTPS origin executes it, and it cannot if the runner
    // never downloaded it.
    expect(workflow).toContain("chromium firefox webkit");
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

/**
 * WebKit is gated on the rig serving HTTPS, and the gate has to stay loud.
 *
 * ADR 0211 puts real-origin qualification on the deployed Preview, and WebKit's
 * refusal to send a `Secure` cookie over plain HTTP makes it a real-origin
 * question rather than an engine question — the loopback rig cannot admit an
 * owner on it at all. So the project stays defined and is skipped with a reason
 * instead of quietly disappearing, because a project that vanished on HTTP would
 * let a green `Promotion verify` read as three-engine evidence. These tests fail
 * if the gate, the reason, or the wiring that applies it is removed.
 */
describe("WebKit is gated on a real HTTPS origin", () => {
  it("runs WebKit only where the rig serves HTTPS", () => {
    expect(unsupportedEngineReason("webkit", "https://tendnote-preview.vercel.app")).toBeNull();
    expect(unsupportedEngineReason("webkit", "https://localhost:3110")).toBeNull();
    expect(unsupportedEngineReason("webkit", "http://localhost:3110")).toBe(
      WEBKIT_LOOPBACK_SKIP_REASON,
    );
    expect(unsupportedEngineReason("webkit", "http://127.0.0.1:3110")).toBe(
      WEBKIT_LOOPBACK_SKIP_REASON,
    );
    // A base URL that cannot be read is not an HTTPS origin. Treating it as one
    // would turn the guard into the silent pass it exists to prevent.
    expect(unsupportedEngineReason("webkit", "not a url")).toBe(WEBKIT_LOOPBACK_SKIP_REASON);
  });

  it("gates nothing else", () => {
    for (const engine of ["chromium", "firefox"]) {
      expect(unsupportedEngineReason(engine, "http://localhost:3110")).toBeNull();
      expect(unsupportedEngineReason(engine, "https://localhost:3110")).toBeNull();
    }
  });

  it("says what did not happen and where it happens instead", () => {
    // The string is the only thing a reader of a green run actually sees, so an
    // empty or vague reason is the failure mode worth catching.
    expect(WEBKIT_LOOPBACK_SKIP_REASON).toContain("NOT covered");
    expect(WEBKIT_LOOPBACK_SKIP_REASON).toContain(
      "docs/verification/nextjs-16-3-preview-qualification.md",
    );
    expect(WEBKIT_LOOPBACK_SKIP_REASON.length).toBeGreaterThan(200);
  });

  it("is applied automatically by the shared fixture, not per spec", () => {
    const fixtures = read("apps/web/tests/instant/support/fixtures.ts");
    // Per-spec opt-in is exactly how an engine ends up half-covered: a spec
    // added later forgets the guard and reports a 30 s admission timeout as a
    // product failure.
    expect(fixtures).toContain("unsupportedEngineReason");
    expect(fixtures).toContain("{ auto: true }");
    expect(fixtures).toMatch(/testInfo\.skip\(true, reason\)/);
  });

  it("keeps the project defined so an HTTPS run can execute it", () => {
    const config = read("apps/web/playwright.config.ts");
    expect(config).toContain('name: "promotion-webkit"');
  });

  it("names uncovered engines in the CI step summary", () => {
    // The diagnostics table only has rows for engines that ran, and a missing
    // row is indistinguishable from an engine nobody configured. The skip has to
    // be recorded where it will be read, not only where Playwright prints it.
    expect(read("apps/web/tests/instant/support/fixtures.ts")).toContain("recordUncoveredEngine");
    const summarize = read("scripts/summarize-instant-diagnostics.mjs");
    expect(summarize).toContain("Engines NOT covered by this run");
    expect(summarize).toContain("uncovered-engines.jsonl");
  });
});

/**
 * One project's failure must stay inside that project (#331).
 *
 * Both browser projects read the one Postgres service the job runs, so a
 * mutation spec that aborts before it restores hands the next project a dirty
 * world. That is how a single reconciliation-budget breach on `desktop-chromium`
 * came back as a second, quite different-looking failure on `mobile-chromium` —
 * "element(s) not found" for a row that was simply still completed. The gate is
 * only readable if a failure count means what it says.
 */
describe("A mutation scenario cannot dirty the next project", () => {
  it("restores its record however the test exited", () => {
    const spec = read("apps/web/tests/instant/action-reconciliation.spec.ts");
    // Unconditional, not `if (testInfo.status !== 'passed')`: a teardown that
    // only runs on the path nobody exercises is one nobody knows is broken.
    expect(spec).toContain("test.afterEach");
    expect(spec).toContain("restoreMutationAction");
  });

  it("clears the cached projection as well as the row", () => {
    // Measured, not assumed. With only the database write in place, a forced
    // mid-way failure left the row correctly `open` and the next project still
    // failed on the same missing locator: the Actions surface is `use cache`
    // backed. The teardown finishes through the product's own signed
    // out-of-band reconciliation endpoint rather than a test-only cache door.
    const restore = read("apps/web/tests/instant/support/fixture-restore.ts");
    expect(restore).toContain("restoreInstantMutationAction");
    expect(restore).toContain("/api/internal/cache/reconcile");
  });
});
