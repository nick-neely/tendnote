import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authoredInstructions } from "./instructions-source";

const subagentRoot = join(process.cwd(), "agent/subagents/memory_curator");

describe("Memory Curator subagent", () => {
  it("is declared as a review-only specialist the parent can delegate to", () => {
    const source = readFileSync(join(subagentRoot, "agent.ts"), "utf8");
    expect(source).toContain("defineAgent");
    expect(source).toMatch(/description:/);
    expect(source).toMatch(/Review-only specialist/i);
    expect(authoredInstructions()).toMatch(/memory_curator/);
  });

  it("has isolated instructions that block direct durable memory mutation", () => {
    const instructions = readFileSync(join(subagentRoot, "instructions.md"), "utf8");
    expect(instructions).toMatch(/review-only/i);
    expect(instructions).toMatch(
      /must not approve, edit, archive, merge, or delete durable Memories/i,
    );
    expect(instructions).toMatch(/source grounding/i);
  });

  it("exposes only a read-only proposal tool with no memory mutation imports", () => {
    const tool = readFileSync(join(subagentRoot, "tools/propose_memory_cleanup.ts"), "utf8");
    expect(tool).toContain("getMemoryCuratorProposals");
    expect(tool).toContain("resolveOwnerUserId");
    expect(tool).toContain("sourceRefs");
    expect(tool).not.toContain("sourceCount");
    const imports = [...tool.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).not.toEqual(expect.arrayContaining(["@tendnote/db/queries/memories"]));
    expect(tool).not.toMatch(
      /\b(saveSuggestedMemory|dismissSuggestedMemory|updateMemory|createMemory|archiveMemory|deleteMemory|mergeMemory)\s*\(/,
    );
  });
});
