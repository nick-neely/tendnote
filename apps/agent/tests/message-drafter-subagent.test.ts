import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authoredInstructions } from "./instructions-source";

const subagentRoot = join(process.cwd(), "agent/subagents/message_drafter");

describe("Message Drafter subagent", () => {
  it("is declared as an ephemeral proposal specialist the parent can delegate to", () => {
    const source = readFileSync(join(subagentRoot, "agent.ts"), "utf8");
    expect(source).toContain("defineAgent");
    expect(source).toMatch(/Draft Proposals/i);
    expect(authoredInstructions()).toMatch(/message_drafter/);
    expect(authoredInstructions()).toMatch(/create_message_draft/);
  });

  it("blocks durable persistence and external drafts inside isolated instructions", () => {
    const instructions = readFileSync(join(subagentRoot, "instructions.md"), "utf8");
    expect(instructions).toMatch(/ephemeral/i);
    expect(instructions).toMatch(/revisionContext/i);
    expect(instructions).toMatch(/acceptedProposal/i);
    expect(instructions).toMatch(/must not call or simulate durable draft persistence/i);
    expect(instructions).toMatch(/must not create Gmail drafts, external drafts, sends/i);
  });

  it("exposes only a proposal tool with source grounding and no durable draft imports", () => {
    const tool = readFileSync(join(subagentRoot, "tools/propose_message_draft.ts"), "utf8");
    expect(tool).toContain("proposeDraft");
    expect(tool).toContain("resolveOwnerUserId");
    expect(tool).toContain("revisionContext");
    expect(tool).toContain("sourceRefs");
    expect(tool).toMatch(/id:\s*sourceRef\.id/);
    const imports = [...tool.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).not.toContain("@tendnote/db/queries/drafts");
    expect(imports).not.toEqual(expect.arrayContaining(["@tendnote/db/queries/gmail-drafts"]));
    expect(tool).not.toMatch(/\b(generateDraft|createDraft|saveDraft|save_draft_to_gmail)\s*\(/);
  });
});
