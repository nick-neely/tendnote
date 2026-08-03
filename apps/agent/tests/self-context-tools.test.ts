import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const toolsDir = join(process.cwd(), "agent/tools");

function readTool(name: string): string {
  return readFileSync(join(toolsDir, `${name}.ts`), "utf8");
}

describe("Self Context Eve tools", () => {
  it("exposes exact list and lookup through the shared product layer", () => {
    const listSource = readTool("list_self_context");

    expect(listSource).toContain("listSelfContextFacts");
    expect(readTool("get_self_context_fact")).toContain("getSelfContextFact");
    expect(listSource).toContain("factsByCategory");
    expect(listSource).toContain("toSelfContextResult");
    expect(listSource).toContain("results");
    expect(listSource).toMatch(/exact|categorized/i);
    expect(listSource).not.toMatch(/personality profile|generated profile|you seem like/i);
  });

  it("reloads the owner-scoped orientation on every turn and has a fail-closed fallback", () => {
    const source = readFileSync(join(process.cwd(), "agent/instructions/self-context.ts"), "utf8");

    expect(source).toContain('"turn.started"');
    expect(source).toContain("getOrientationContext");
    expect(source).toContain("buildUnavailableSelfContextInstructionsMarkdown");
  });

  it.each([
    ["remember_self_context", "createSelfContextFact"],
    ["update_self_context", "updateSelfContextFact"],
    ["archive_self_context", "archiveSelfContextFact"],
    ["restore_self_context", "restoreSelfContextFact"],
  ])("%s stays a thin wrapper over %s", (tool, sharedFunction) => {
    const source = readTool(tool);
    expect(source).toContain(sharedFunction);
    expect(source).toContain("resolveOwnerUserId(ctx)");
    expect(source).toContain("requestBackgroundAffectedScopeReconciliation");
    expect(source).not.toMatch(/ownerUserId:\s*input\./);
  });

  it("keeps explicit Self Context mutation separate from permanent deletion", () => {
    for (const tool of [
      "remember_self_context",
      "update_self_context",
      "archive_self_context",
      "restore_self_context",
    ]) {
      expect(readTool(tool)).not.toContain("deleteSelfContextFact");
    }
  });
});
