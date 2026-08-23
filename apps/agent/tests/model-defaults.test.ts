import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "../../..");
const GEMINI = "google/gemini-3.7-flash";

const authoritativeDefaults = [
  ".github/workflows/eve-evals.yml",
  "apps/agent/.env.example",
  "apps/agent/README.md",
  "apps/agent/agent/agent.ts",
  "apps/agent/agent/subagents/memory_curator/agent.ts",
  "apps/agent/agent/subagents/message_drafter/agent.ts",
  "apps/agent/agent/subagents/privacy_guard/agent.ts",
  "apps/agent/agent/subagents/relationship_strategist/agent.ts",
  "apps/agent/scripts/model-comparison.mjs",
  "apps/web/.env.example",
  "docs/eve-eval-foundation.md",
  "docs/local-development.md",
  "packages/db/src/queries/asset-snapshots.ts",
  "packages/db/src/queries/briefs.ts",
  "packages/db/src/queries/context-snapshots.ts",
  "packages/db/src/queries/drafts.ts",
  "packages/db/src/queries/today/ranker.ts",
] as const;

describe("production model defaults", () => {
  it.each(authoritativeDefaults)("defaults %s to the selected Gemini model", (path) => {
    const source = readFileSync(join(repoRoot, path), "utf8");
    expect(source).toContain(GEMINI);
    expect(source).not.toMatch(/claude-(?:haiku|sonnet)/i);
  });

  it("keeps every authored subagent on the same environment override and fallback", () => {
    for (const path of authoritativeDefaults.filter((path) => path.includes("/subagents/"))) {
      const source = readFileSync(join(repoRoot, path), "utf8");
      expect(source).toMatch(/process\.env\.TENDNOTE_AGENT_MODEL\s*\?\?/);
      expect(source).toContain(GEMINI);
    }
  });

  it("wires one resolved workflow model into both evaluation and evidence packaging", () => {
    const source = readFileSync(join(repoRoot, ".github/workflows/eve-evals.yml"), "utf8");
    expect(
      source.match(/AGENT_MODEL: \$\{\{ vars\.TENDNOTE_AGENT_MODEL \|\| '[^']+' \}\}/g),
    ).toEqual([`AGENT_MODEL: \${{ vars.TENDNOTE_AGENT_MODEL || '${GEMINI}' }}`]);
    expect(source).toContain(
      'DATABASE_URL="$TENDNOTE_EVAL_DATABASE_URL" TENDNOTE_AGENT_MODEL="$AGENT_MODEL"',
    );
    expect(source).toContain("--max-concurrency 1 --junit .eve/evals/junit.xml");
    expect(source).not.toContain("deterministic-eval-retry");
    expect(source).toContain('--agent-model "$AGENT_MODEL"');
  });
});
