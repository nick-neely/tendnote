import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

/** Everything under `jobs:`, so `on:` keys cannot be mistaken for job ids. */
function jobsSection(workflow: string): string {
  const start = workflow.indexOf("\njobs:\n");

  return start === -1 ? "" : workflow.slice(start + "\njobs:".length);
}

/** The text of one top-level job, from its id to the next job id. */
function jobBlock(workflow: string, jobId: string): string {
  const block = new RegExp(`\\n {2}${jobId}:\\n[\\s\\S]*?(?=\\n {2}[a-z_]+:\\n|$)`).exec(
    jobsSection(workflow),
  );

  return block?.[0] ?? "";
}

/** Top-level job ids, in declaration order. */
function jobIds(workflow: string): string[] {
  return [...jobsSection(workflow).matchAll(/^ {2}([a-z_]+):$/gm)].map(([, id]) => id);
}

/** Job-level `name:` values, which are what GitHub publishes as check runs. */
function jobNames(workflow: string): string[] {
  return [...jobsSection(workflow).matchAll(/^ {4}name: (.+)$/gm)].map(([, name]) => name);
}

// The required checks are the verification jobs themselves (ADR 0236), and a
// job that skips itself reports success. So the ruleset is derivable from the
// workflows rather than a literal someone has to keep in step with them: a
// reusable workflow's jobs publish as `<caller job id> / <job name>`.
const CALLER_JOB_ID = "verify";

function derivedRequiredContexts(): string[] {
  return [
    ...jobNames(read(".github/workflows/pr-verify.yml")),
    ...jobNames(read(".github/workflows/reusable-verify.yml")).map(
      (name) => `${CALLER_JOB_ID} / ${name}`,
    ),
    // Not Actions jobs, so these two cannot be derived.
    "Vercel",
    "license/cla",
  ];
}

describe("CI workflow optimization contract", () => {
  it("protects main behind the verification jobs, Vercel, and the CLA", () => {
    const ruleset = JSON.parse(read(".github/rulesets/protect-main.json"));
    const rules = new Map(ruleset.rules.map((rule: { type: string }) => [rule.type, rule]));
    const pullRequest = rules.get("pull_request") as {
      parameters: Record<string, unknown>;
    };
    const statusChecks = rules.get("required_status_checks") as {
      parameters: {
        strict_required_status_checks_policy: boolean;
        required_status_checks: Array<{ context: string; integration_id?: number }>;
      };
    };

    expect(ruleset.enforcement).toBe("active");
    expect(ruleset.conditions.ref_name.include).toContain("~DEFAULT_BRANCH");
    expect(rules.has("deletion")).toBe(true);
    expect(rules.has("non_fast_forward")).toBe(true);
    expect(pullRequest.parameters.required_approving_review_count).toBe(1);
    expect(pullRequest.parameters.require_code_owner_review).toBe(true);
    expect(pullRequest.parameters.required_review_thread_resolution).toBe(true);
    expect(pullRequest.parameters.allowed_merge_methods).toEqual(["squash", "rebase"]);
    expect(statusChecks.parameters.strict_required_status_checks_policy).toBe(true);
    // Sorted, because the ruleset's order is presentation and the derivation's
    // is declaration order. What matters is that the sets are identical: no
    // required check without a job, no verification job without a required check.
    expect(
      statusChecks.parameters.required_status_checks.map(({ context }) => context).sort(),
    ).toEqual(derivedRequiredContexts().sort());
    // Actions checks must be pinned to the Actions app; an unpinned context can
    // be satisfied by any commit status with a matching name.
    for (const check of statusChecks.parameters.required_status_checks) {
      if (check.context === "Vercel") continue;
      expect(check.integration_id).toBe(check.context === "license/cla" ? 128106 : 15368);
    }
    expect(ruleset.bypass_actors).toEqual([
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "pull_request",
      },
    ]);
  });

  it("names the caller job the required contexts are derived from", () => {
    const pullRequest = read(".github/workflows/pr-verify.yml");

    // Renaming this job renames every `verify / *` required check with it.
    expect(jobIds(pullRequest)).toEqual(["changes", CALLER_JOB_ID]);
    expect(jobNames(pullRequest)).toEqual(["Detect changes"]);
    expect(jobBlock(pullRequest, CALLER_JOB_ID)).toContain(
      "uses: ./.github/workflows/reusable-verify.yml",
    );
  });

  it("runs one full-fidelity verification path on every code push", () => {
    const pullRequest = read(".github/workflows/pr-verify.yml");
    const reusable = read(".github/workflows/reusable-verify.yml");
    const triggerTypes = [
      ...(pullRequest.match(/types:\n((?:\s*-\s*\w+\n)+)/)?.[1] ?? "").matchAll(/-\s*(\w+)/g),
    ].map(([, type]) => type);

    // `labeled` is the one that mattered: it is what the removed tier hung on.
    expect(triggerTypes).toEqual(["opened", "synchronize", "reopened"]);
    expect(pullRequest).toContain("group: pr-verify-$" + "{{ github.event.pull_request.number }}");
    expect(pullRequest).toContain("cancel-in-progress: true");

    // Identifiers that can only reappear if the tiering itself comes back.
    for (const removed of [
      "full-ci",
      "run_full",
      "fast_tests",
      "verify_gate",
      "qualification_gate",
      "TURBO_SCM_BASE",
    ]) {
      expect(pullRequest).not.toContain(removed);
      expect(reusable).not.toContain(removed);
    }
  });

  it("always calls the reusable workflow so its checks can never hang", () => {
    const pullRequest = read(".github/workflows/pr-verify.yml");
    const caller = jobBlock(pullRequest, "verify");

    // A skipped caller job creates no nested check runs at all, so the required
    // checks would sit on "Expected" forever on a documentation-only pull
    // request. The lanes are gated one level down instead.
    expect(caller).not.toMatch(/^ {4}if:/m);
    expect(caller).toContain("needs: changes");
    expect(caller).toContain("run_quality: $" + "{{ needs.changes.outputs.verify == 'true' }}");
    expect(caller).toContain("run_tests: $" + "{{ needs.changes.outputs.tests == 'true' }}");
    expect(caller).toContain("run_browser: $" + "{{ needs.changes.outputs.browser == 'true' }}");
    expect(caller).toContain("run_instant: $" + "{{ needs.changes.outputs.instant == 'true' }}");
    expect(caller).toContain("run_database: $" + "{{ needs.changes.outputs.database == 'true' }}");
  });

  it("gates every verification job on its own input", () => {
    const reusable = read(".github/workflows/reusable-verify.yml");
    const gates = {
      database: "inputs.run_database",
      quality: "inputs.run_quality",
      test_fallow: "inputs.run_tests",
      instant_matrix: "inputs.run_instant",
    };

    expect(jobIds(reusable).slice().sort()).toEqual(Object.keys(gates).slice().sort());

    for (const [jobId, gate] of Object.entries(gates)) {
      const block = jobBlock(reusable, jobId);

      expect(block).toContain(`\n    if: ${gate}\n`);
      expect(reusable).toContain(`      ${gate.replace("inputs.", "")}:\n`);
    }
  });

  it("keeps documentation-only changes out of the verification lanes", () => {
    const pullRequest = read(".github/workflows/pr-verify.yml");

    // Pinned to a full commit SHA (with a `# vX` comment). Assert the SHA shape,
    // not the specific version: version-agnostic yet still fails if the pin is
    // ever reverted to a mutable tag (@v4, @main), which is the point of the pin.
    expect(pullRequest).toMatch(/uses: dorny\/paths-filter@[0-9a-f]{40}\b/);
    expect(pullRequest).toContain("- 'scripts/**'");
    expect(pullRequest).toContain("- '.github/rulesets/**'");
    expect(pullRequest).not.toContain("- 'docs/**'");
    expect(pullRequest).not.toContain("- 'README.md'");
  });

  it("does not rerun PR verification when a draft becomes ready", () => {
    const workflow = read(".github/workflows/pr-verify.yml");

    expect(workflow).not.toContain("- ready_for_review");
    expect(workflow).not.toContain("- converted_to_draft");
  });

  it("anchors the Fallow audit to the fetched origin/main baseline", () => {
    const reusable = read(".github/workflows/reusable-verify.yml");
    const testFallow = jobBlock(reusable, "test_fallow");

    // Without an explicit base Fallow resolves the branch's own upstream and
    // audits almost nothing; `fetch-depth: 0` is what makes the base resolvable.
    expect(testFallow).toContain("fetch-depth: 0");
    expect(testFallow).toMatch(
      /- name: Run Fallow audit\n\s+env:\n\s+FALLOW_AUDIT_BASE: origin\/main\n\s+run: pnpm fallow:ci/,
    );
    expect(testFallow).toContain("run: pnpm coverage:ci");
    expect(testFallow).toContain("run: pnpm fallow:coverage:check");
  });

  it("keeps the root contracts in a CI lane through the coverage collector", () => {
    // These suites are what holds CI wiring to its contract, and no workflow
    // step runs them directly. `coverage:ci` runs them ahead of the workspaces.
    expect(read("scripts/collect-test-coverage.mjs")).toContain(
      'runPnpm(["exec", "vitest", "run", "scripts"]',
    );
  });

  it("runs the coverage lane on a pinned sixteen-vCPU runner", () => {
    const reusable = read(".github/workflows/reusable-verify.yml");

    // The collector's `--maxWorkers=50%` scales with the runner, and cost is
    // proportional to vCPU-minutes, so a wider box is the same spend.
    expect(jobBlock(reusable, "test_fallow")).toContain(
      "format('runs-on={0}-test-fallow/runner=big/cpu=16', github.run_id)",
    );
  });

  it("runs the real-browser contracts alongside quality, off the critical path", () => {
    const reusable = read(".github/workflows/reusable-verify.yml");
    const quality = jobBlock(reusable, "quality");

    expect(quality).toContain("format('runs-on={0}-quality/runner=default', github.run_id)");
    expect(quality).toMatch(
      /- name: Run real-browser contracts\n\s+if: \$\{\{ inputs\.run_browser \}\}\n\s+run: pnpm test:browser/,
    );
    expect(quality).toContain("playwright install --with-deps chromium");
    // The runner image already carries Chromium's libraries; a cache hit must not pay for apt.
    expect(quality).not.toContain("playwright install-deps chromium");
    expect(jobBlock(reusable, "test_fallow")).not.toContain("pnpm test:browser");
  });

  it("uses the database dependency closure instead of installing the whole workspace", () => {
    const reusable = read(".github/workflows/reusable-verify.yml");
    const databaseJob = jobBlock(reusable, "database");

    expect(databaseJob).toContain("run: pnpm install --frozen-lockfile --filter @tendnote/db...");
    expect(databaseJob).not.toMatch(/run: pnpm install --frozen-lockfile\s*$/m);
  });

  it("routes fork pull requests to GitHub-hosted runners", () => {
    const workflows = [
      read(".github/workflows/pr-verify.yml"),
      read(".github/workflows/promotion-verify.yml"),
      read(".github/workflows/reusable-verify.yml"),
    ].join("\n");
    const runnerDeclarations = workflows.match(/^\s+runs-on:/gm) ?? [];
    const forkFallbacks =
      workflows.match(
        /github\.event\.pull_request\.head\.repo\.fork &&\s*\n\s*'ubuntu-latest' \|\|/g,
      ) ?? [];
    const guardedRunsOnSetupSteps =
      workflows.match(
        // `runs-on/action` is pinned to a full commit SHA; assert the SHA shape so
        // a revert to a mutable `@v2` tag still fails this contract.
        /name: Set up RunsOn\s*\n\s+if: \$\{\{ github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.head\.repo\.fork \}\}\s*\n\s+uses: runs-on\/action@[0-9a-f]{40}\b/g,
      ) ?? [];

    // Untrusted fork code must never reach the private runner network or its
    // cache sidecar, so every runner declaration needs both halves of the guard.
    expect(forkFallbacks).toHaveLength(runnerDeclarations.length);
    expect(guardedRunsOnSetupSteps).toHaveLength(runnerDeclarations.length);
  });

  it("keeps the promotion tier on the same verification definition", () => {
    const promotion = read(".github/workflows/promotion-verify.yml");

    // Its caller job id must differ from `pr-verify`'s. Nested jobs publish as
    // `<caller job id> / <job name>`, so a shared id would let this workflow
    // post the pull request's own required contexts from a different trigger.
    expect(jobIds(promotion)).not.toContain(CALLER_JOB_ID);
    expect(promotion).toContain("uses: ./.github/workflows/reusable-verify.yml");
    expect(promotion).toContain("full_browser_matrix: true");
    for (const input of [
      "run_quality",
      "run_tests",
      "run_browser",
      "run_instant",
      "run_database",
    ]) {
      expect(promotion).toContain(`${input}: true`);
    }
  });

  it("shares one Chromium cache and primes it from the trusted default branch", () => {
    const reusable = read(".github/workflows/reusable-verify.yml");
    const prime = read(".github/workflows/playwright-cache.yml");
    // `runner.os` is `Linux` on x64 and arm64 alike, so the architecture is part
    // of the key: a cache primed on one and restored on the other yields browser
    // binaries that fail at launch rather than at restore.
    const chromiumKey =
      "$" +
      "{{ runner.os }}-$" +
      "{{ runner.arch }}-playwright-chromium-$" +
      "{{ hashFiles('pnpm-lock.yaml') }}";

    expect(reusable.split(chromiumKey)).toHaveLength(3);
    expect(prime).toContain("push:");
    expect(prime).toContain("- main");
    expect(prime).toContain("- 'pnpm-lock.yaml'");
    expect(prime).toContain(chromiumKey);
    expect(prime).toContain("playwright install chromium");
    expect(prime).not.toContain("playwright install --with-deps chromium");
  });

  it("releases ready Vercel deployments through an event-driven migration check", () => {
    const workflow = read(".github/workflows/production-migrations.yml");
    const vercel = JSON.parse(read("apps/web/vercel.json"));
    const validation = jobBlock(workflow, "validate");
    const release = jobBlock(workflow, "release");

    expect(workflow).not.toContain("uses: ./.github/workflows/reusable-verify.yml");
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("- vercel.deployment.ready");
    expect(jobIds(workflow)).toEqual(["validate", "report_invalid", "release"]);
    expect(validation).toContain("name: Validate production release event");
    expect(validation).toContain("runner=light");
    expect(validation).toContain("uses: runs-on/action@");
    expect(validation).not.toMatch(/^ {4}if:/m);
    expect(validation).toContain("id: validate");
    expect(validation).toContain("run: node scripts/production-release-event.mjs");
    expect(validation).toContain("VERCEL_EXPECTED_PROJECT_ID: $" + "{{ vars.VERCEL_PROJECT_ID }}");
    const invalid = jobBlock(workflow, "report_invalid");
    expect(invalid).toContain("needs: validate");
    expect(invalid).toContain("always() && needs.validate.result == 'failure'");
    expect(invalid).not.toContain("vercel/repository-dispatch/actions/status@");
    expect(invalid).toContain("keys the commit");
    expect(invalid).toContain("exit 1");
    expect(release).toContain("needs: validate");
    expect(release).toContain("if: needs.validate.outputs.should_release == 'true'");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("statuses: write");
    // Pinned to a full commit SHA (with a `# v1` comment); assert the SHA shape so
    // a revert to a mutable `@v1` tag still fails this contract.
    expect(workflow).toMatch(/vercel\/repository-dispatch\/actions\/status@[0-9a-f]{40}\b/);
    expect(workflow).toMatch(/vercel\/repository-dispatch\/actions\/checkout@[0-9a-f]{40}\b/);
    expect(workflow).toContain(
      "VERCEL_EVENT_ENVIRONMENT: $" + "{{ github.event.client_payload.environment }}",
    );
    expect(workflow).toContain(
      "VERCEL_EVENT_PROJECT_ID: $" + "{{ github.event.client_payload.project.id }}",
    );
    expect(workflow).toContain("VERCEL_EVENT_REF: $" + "{{ github.event.client_payload.git.ref }}");
    expect(workflow).toContain(
      "VERCEL_EVENT_STATE: $" + "{{ github.event.client_payload.state.type }}",
    );
    expect(read("scripts/production-release-event.mjs")).toContain(
      "Production migration gate is not configured",
    );
    expect(workflow).toContain("pnpm install --frozen-lockfile --filter @tendnote/db...");
    expect(workflow).toContain("pnpm db:migrate");
    expect(workflow).not.toContain("git diff --quiet");
    expect(workflow).not.toContain("steps.changes.outputs.database");
    expect(workflow).not.toContain("push:");
    expect(workflow).not.toContain("sleep 10");
    expect(workflow).not.toContain("vercel promote");
    expect(workflow).not.toContain("VERCEL_TOKEN");
    expect(workflow).not.toContain("VERCEL_CLI_VERSION");
    expect(vercel.ignoreCommand).toBe("npx turbo-ignore --fallback=HEAD^1");
  });
});
