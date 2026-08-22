import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectAllMatch } from "./instruction-expectations";
import { authoredInstructions } from "./instructions-source";
import { asTestTool, toolModelValue } from "./test-tool";

const { getMemoryCuratorProposals } = vi.hoisted(() => ({ getMemoryCuratorProposals: vi.fn() }));

vi.mock("@tendnote/db/queries/memory-curator", () => ({ getMemoryCuratorProposals }));

const subagentRoot = join(process.cwd(), "agent/subagents/memory_curator");
const MEMORY_ID = "55555555-5555-4555-8555-555555555555";
const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function instructions(): string {
  return readFileSync(join(subagentRoot, "instructions/base.md"), "utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Memory Curator subagent", () => {
  it("is declared as a review-only specialist the parent can delegate to", () => {
    const source = readFileSync(join(subagentRoot, "agent.ts"), "utf8");
    expect(source).toContain("defineAgent");
    expect(source).toMatch(/description:/);
    expect(source).toMatch(/Review-only specialist/i);
    expect(authoredInstructions()).toMatch(/memory_curator/);
  });

  it("has isolated instructions that block direct durable memory mutation", () => {
    expect(instructions()).toMatch(/review-only/i);
    expect(instructions()).toMatch(
      /must not approve, edit, archive, merge, or delete durable Memories/i,
    );
    expect(instructions()).toMatch(/source grounding/i);
  });

  /**
   * Nine lines of boundary and nothing about the work itself: the curator knew what it
   * could not do and had no standard for what it should return. These are the rules a
   * cleanup proposal is actually judged by (ADR 0123 keeps it review-only).
   */
  it("says what a good cleanup proposal looks like, not only what is forbidden", () => {
    expectAllMatch(instructions(), [
      /what a good proposal looks like/i,
      /Grounded/,
      /Few\./,
      /A long list is not review/i,
      /do not judge the owner's record-keeping/i,
      /Never a raw id/i,
      /do not invent a candidate/i,
    ]);
    // It inherits nothing, including the date its own staleness judgements need.
    expectAllMatch(instructions(), [
      /inherit nothing from the parent agent/i,
      /date anchor/i,
      /PROPOSAL_COUNT: N/,
      /count[\s\S]*propose_memory_cleanup/i,
    ]);
  });

  it("exposes only a read-only proposal tool with no memory mutation imports", () => {
    const tool = readFileSync(join(subagentRoot, "tools/propose_memory_cleanup.ts"), "utf8");
    expect(tool).toContain("getMemoryCuratorProposals");
    expect(tool).toContain("resolveOwnerUserId");
    expect(tool).toContain("withModelSafeStoreErrors");
    expect(tool).toContain("sourceRefs");
    expect(tool).not.toContain("sourceCount");
    const imports = [...tool.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).not.toEqual(expect.arrayContaining(["@tendnote/db/queries/memories"]));
    expect(tool).not.toMatch(
      /\b(saveSuggestedMemory|dismissSuggestedMemory|updateMemory|createMemory|archiveMemory|deleteMemory|mergeMemory)\s*\(/,
    );
  });

  it("gives the tool a trigger, and stops the owner id and the record ids at the tool", async () => {
    getMemoryCuratorProposals.mockResolvedValue({
      ownerUserId: "user-1",
      component: { type: "memory_curator_proposals", proposalCount: 1 },
      proposals: [
        {
          id: "duplicate_memory:1",
          kind: "duplicate_memory",
          ownerUserId: "user-1",
          personId: null,
          personDisplayName: "Priya",
          title: "Two memories about Priya's role",
          reason: "They say slightly different things.",
          suggestedAction: "Keep the clearer one.",
          sourceRefs: [{ kind: "memory", id: MEMORY_ID, label: "Priya leads the platform team" }],
          sensitivity: "normal",
          reviewOnly: true,
        },
      ],
    });
    const { default: rawTool } = await import(
      "../agent/subagents/memory_curator/tools/propose_memory_cleanup"
    );
    const tool = asTestTool(rawTool);

    // A description with no trigger left the parent guessing when this agent was for.
    expect(rawTool.description).toMatch(/tidy, clean up, review/i);
    expect(rawTool.description).toMatch(/never approves, edits, archives/i);

    const result = await tool.execute({}, ctx);

    expect(getMemoryCuratorProposals).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      limit: undefined,
    });
    // Owner scoping identifies the caller to the caller; it is not part of a proposal.
    expect(JSON.stringify(result)).not.toContain("user-1");
    expect(result.component.proposalCount).toBe(1);

    const model = toolModelValue(rawTool, result);
    const serialized = JSON.stringify(model);
    expect(serialized).toContain("Priya");
    expect(serialized).not.toContain(MEMORY_ID);
    expect(model.guidance).toMatch(/review-only/i);
    expect(model.count).toBe(1);
  });
});
