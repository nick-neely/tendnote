import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");

function trackedWorkflowPaths(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ".github/workflows"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => join(repoRoot, path));
}

describe("CI workflow safety contract", () => {
  it("keeps workflow triggers on pull_request or explicit dispatch only", () => {
    const unsafePaths = trackedWorkflowPaths().filter((path) =>
      /\bpull_request_target\b/.test(readFileSync(path, "utf8")),
    );

    expect(unsafePaths).toEqual([]);
  });

  it("requires code-owner review for workflow and RunsOn changes", () => {
    const codeowners = readFileSync(join(repoRoot, ".github/CODEOWNERS"), "utf8");
    const ruleset = JSON.parse(
      readFileSync(join(repoRoot, ".github/rulesets/protect-main.json"), "utf8"),
    ) as {
      rules: Array<{
        type: string;
        parameters?: {
          require_code_owner_review?: boolean;
          required_approving_review_count?: number;
        };
      }>;
    };
    const pullRequestRule = ruleset.rules.find((rule) => rule.type === "pull_request");

    expect(codeowners).toMatch(/^\/.github\/workflows\/\*\*\s+@nick-neely$/m);
    expect(codeowners).toMatch(/^\/.github\/runs-on\.yml\s+@nick-neely$/m);
    expect(pullRequestRule?.parameters?.require_code_owner_review).toBe(true);
    expect(pullRequestRule?.parameters?.required_approving_review_count).toBeGreaterThan(0);
  });
});
