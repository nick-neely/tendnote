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
    expect(statusChecks.parameters.strict_required_status_checks_policy).toBe(true);
    expect(statusChecks.parameters.required_status_checks.map(({ context }) => context)).toEqual([
      "Verify",
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

    expect(workflow).toContain("name: Verify");
    expect(workflow).toContain("uses: ./.github/workflows/reusable-verify.yml");
    expect(workflow).toContain("- 'scripts/**'");
    expect(workflow).not.toContain("- 'docs/**'");
    expect(workflow).not.toContain("- 'README.md'");
  });

  it("keeps draft iteration fast and requires an explicit full CI qualification before merge", () => {
    const pullRequest = read(".github/workflows/pr-verify.yml");
    const reusable = read(".github/workflows/reusable-verify.yml");

    expect(pullRequest).toContain("full-ci");
    expect(pullRequest).toContain("github.event.pull_request.draft");
    expect(pullRequest).toContain("run_full:");
    expect(pullRequest).toContain("Full CI qualification is required before merge.");
    expect(pullRequest).toContain("github.run_id");
    expect(pullRequest).toContain("github.event.label.name != 'full-ci'");
    expect(pullRequest.split("github.event.label.name == 'full-ci'")).toHaveLength(3);

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
