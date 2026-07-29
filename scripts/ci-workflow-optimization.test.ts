import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("CI workflow optimization contract", () => {
  it("protects main behind the stable PR and Vercel checks", () => {
    const ruleset = JSON.parse(read(".github/rulesets/protect-main.json"));
    const rules = new Map(ruleset.rules.map((rule: { type: string }) => [rule.type, rule]));
    const pullRequest = rules.get("pull_request") as {
      parameters: Record<string, unknown>;
    };
    const statusChecks = rules.get("required_status_checks") as {
      parameters: {
        strict_required_status_checks_policy: boolean;
        required_status_checks: Array<{ context: string }>;
      };
    };

    expect(ruleset.enforcement).toBe("active");
    expect(ruleset.conditions.ref_name.include).toContain("~DEFAULT_BRANCH");
    expect(rules.has("deletion")).toBe(true);
    expect(rules.has("non_fast_forward")).toBe(true);
    expect(pullRequest.parameters.required_approving_review_count).toBe(0);
    expect(pullRequest.parameters.required_review_thread_resolution).toBe(true);
    expect(pullRequest.parameters.allowed_merge_methods).toEqual(["squash", "rebase"]);
    expect(statusChecks.parameters.strict_required_status_checks_policy).toBe(true);
    expect(statusChecks.parameters.required_status_checks.map(({ context }) => context)).toEqual([
      "Verify",
      "Full CI qualification",
      "Vercel",
    ]);
    expect(ruleset.bypass_actors).toEqual([
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "pull_request",
      },
    ]);
  });

  it("keeps one stable PR gate and does not verify documentation-only changes", () => {
    const workflow = read(".github/workflows/pr-verify.yml");

    expect(workflow).toMatch(
      /verify_gate:\n\s+name: \$\{\{[^}]*'Verify'[^}]*\}\}/,
    );
    expect(workflow).toMatch(
      /qualification_gate:\n\s+name: \$\{\{[^}]*'Full CI qualification'[^}]*'Qualification pending'[^}]*\}\}/,
    );
    expect(workflow).not.toContain("docs_qualification:");
    expect(workflow).not.toContain(
      "github.event.action != 'labeled' && needs.changes.outputs.verify != 'true' && 'Full CI qualification' || 'Qualification required'",
    );
    expect(workflow).toContain("uses: ./.github/workflows/reusable-verify.yml");
    expect(workflow).toContain("- 'scripts/**'");
    expect(workflow).not.toContain("- 'docs/**'");
    expect(workflow).not.toContain("- 'README.md'");
  });

  it("runs only workflow contracts for CI-only draft changes", () => {
    const pullRequest = read(".github/workflows/pr-verify.yml");
    const reusable = read(".github/workflows/reusable-verify.yml");
    const fastPackageFilter = pullRequest.match(
      /fast_packages:\n([\s\S]*?)\n            browser:/,
    )?.[1];
    const modeScript = pullRequest.match(
      /- name: Select verification tier[\s\S]*?echo "full_requested=.*?\n/,
    )?.[0];

    expect(fastPackageFilter).toBeDefined();
    expect(modeScript).toBeDefined();
    expect(fastPackageFilter).not.toContain(".github/workflows");
    expect(fastPackageFilter).not.toContain("scripts/");
    expect(pullRequest).toContain("fast_packages: ${{ steps.mode.outputs.fast_packages }}");
    expect(pullRequest).toContain("database: ${{ steps.mode.outputs.database }}");
    expect(pullRequest).toContain("github.event.before");
    expect(modeScript).toContain("'tsconfig*.json'");
    expect(pullRequest).toContain(
      "Workflow-only pushes intentionally skip Database; full-ci evaluates the complete PR.",
    );
    expect(pullRequest).toMatch(
      /name: Checkout pushed commit range\s+if: github\.event\.action == 'synchronize'/,
    );
    expect(reusable).toContain("run_fast_packages:");
    expect(reusable).toContain("pnpm exec vitest run scripts/*.test.ts");
    expect(reusable).toMatch(
      /name: Run affected package tests\s+if: \$\{\{ inputs\.run_fast_packages \}\}/,
    );
  });

  it("does not rerun PR verification when an already-qualified draft becomes ready", () => {
    const workflow = read(".github/workflows/pr-verify.yml");

    expect(workflow).not.toContain("- ready_for_review");
    expect(workflow).not.toContain("- converted_to_draft");
  });

  it("auto-qualifies documentation-only commits without running full CI", () => {
    const workflow = read(".github/workflows/pr-verify.yml");

    expect(workflow).toMatch(
      /qualification_gate:[\s\S]*needs\.changes\.outputs\.verify != 'true'[\s\S]*'Full CI qualification'/,
    );
    expect(workflow).toMatch(
      /qualification_gate:[\s\S]*github\.event\.action != 'labeled'[\s\S]*needs\.changes\.result == 'success'/,
    );
  });

  it("qualifies only the exact commit where full-ci is newly applied", () => {
    const pullRequest = read(".github/workflows/pr-verify.yml");
    const reusable = read(".github/workflows/reusable-verify.yml");

    expect(pullRequest).not.toMatch(/name: >-\s+\$\{\{/);
    expect(pullRequest).toContain("full-ci");
    expect(pullRequest).toContain("- labeled");
    expect(pullRequest).not.toContain("- unlabeled");
    expect(pullRequest).toContain("'Full CI qualification'");
    expect(pullRequest).toMatch(
      /verify_gate:[\s\S]*github\.event\.label\.name == 'full-ci'/,
    );
    expect(pullRequest).toContain(
      "github.event.action == 'labeled' && github.event.label.name == 'full-ci'",
    );
    expect(pullRequest).not.toContain(
      "contains(github.event.pull_request.labels.*.name, 'full-ci')",
    );
    expect(pullRequest).toContain("run_full:");
    expect(pullRequest).toContain("github.run_id");
    expect(pullRequest).toContain("format('pr-verify-{0}-ignored-{1}'");

    expect(reusable).toContain("run_full:");
    expect(reusable).toMatch(/fast_tests:[\s\S]*if: \$\{\{[^}]*!inputs\.run_full/);
    expect(reusable).toMatch(
      /test_fallow:[\s\S]*if: \$\{\{[^}]*(inputs\.run_tests \|\| inputs\.run_browser)[^}]*inputs\.run_full/,
    );
    expect(reusable).toMatch(/name: Run tests with coverage\s+if: \$\{\{ inputs\.run_tests \}\}/);
    expect(reusable).toMatch(
      /name: Run real-browser contracts\s+if: \$\{\{ inputs\.run_browser \}\}/,
    );
    expect(reusable).toMatch(
      /instant_matrix:[\s\S]*if: \$\{\{[^}]*inputs\.run_full[^}]*inputs\.run_instant/,
    );
  });

  it("shares one Chromium cache and primes it from the trusted default branch", () => {
    const reusable = read(".github/workflows/reusable-verify.yml");
    const prime = read(".github/workflows/playwright-cache.yml");
    const chromiumKey =
      "$" + "{{ runner.os }}-playwright-chromium-$" + "{{ hashFiles('pnpm-lock.yaml') }}";

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

    expect(workflow).not.toContain("uses: ./.github/workflows/reusable-verify.yml");
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("- vercel.deployment.ready");
    expect(workflow).toContain("statuses: write");
    expect(workflow).toContain("vercel/repository-dispatch/actions/status@v1");
    expect(workflow).toContain("vercel/repository-dispatch/actions/checkout@v1");
    expect(workflow).toContain("github.event.client_payload.environment == 'production'");
    expect(workflow).toContain(
      "github.event.client_payload.project.id == 'prj_hdGusP01mnLoDvQc3CQ1gha2at7E'",
    );
    expect(workflow).toContain("github.event.client_payload.git.ref == 'main'");
    expect(workflow).toContain("github.event.client_payload.state.type == 'ready'");
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
