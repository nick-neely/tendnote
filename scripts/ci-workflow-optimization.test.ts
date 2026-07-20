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

  it("trusts protected PR verification and only releases deployable main changes", () => {
    const workflow = read(".github/workflows/production-migrations.yml");
    const vercel = JSON.parse(read("apps/web/vercel.json"));

    expect(workflow).not.toContain("uses: ./.github/workflows/reusable-verify.yml");
    expect(workflow).toContain("if: needs.changes.outputs.deploy == 'true'");
    expect(workflow).not.toContain("- 'docs/**'");
    expect(workflow).not.toContain("- 'README.md'");
    expect(vercel.ignoreCommand).toBe("npx turbo-ignore --fallback=HEAD^1");
  });
});
