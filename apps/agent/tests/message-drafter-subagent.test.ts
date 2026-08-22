import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectAllMatch } from "./instruction-expectations";
import { authoredInstructions } from "./instructions-source";

const subagentRoot = join(process.cwd(), "agent/subagents/message_drafter");

function instructions(): string {
  return readFileSync(join(subagentRoot, "instructions/base.md"), "utf8");
}

describe("Message Drafter subagent", () => {
  it("is declared as an ephemeral proposal specialist the parent can delegate to", () => {
    const source = readFileSync(join(subagentRoot, "agent.ts"), "utf8");
    expect(source).toContain("defineAgent");
    expect(source).toMatch(/Draft Proposals/i);
    expect(authoredInstructions()).toMatch(/message_drafter/);
    expect(authoredInstructions()).toMatch(/create_message_draft/);
  });

  it("blocks durable persistence and external drafts inside isolated instructions", () => {
    expectAllMatch(instructions(), [
      /ephemeral/i,
      /revisionContext/i,
      /acceptedProposal/i,
      /must not call or simulate durable draft persistence/i,
      /must not create Gmail drafts, external drafts, sends/i,
    ]);
  });

  /**
   * This subagent is the default first-pass drafting path, and it could not see one
   * line of the drafting quality bar: the skill that carries the trust tiers, the
   * no-fake-memory rule, and the no-greeting-card rule is the *root's* skill, and a
   * subagent inherits nothing. A hollow, warmly-fabricated draft was one delegation
   * away with nothing in the child's own prompt to stop it.
   */
  it("carries the drafting quality bar the root's skill never reaches it", () => {
    // Trust tiers, by the names that actually appear in `sourceRefs`.
    expectAllMatch(instructions(), [
      /approved_memory/,
      /source_record/,
      /suggested_memory/,
      /never as an established fact/i,
    ]);

    expectAllMatch(instructions(), [
      /No fake memory/i,
      /Never invent a shared event/i,
      /No fake sentimentality/i,
      /Hope this finds you well/,
      /tone request verbatim as `toneInstruction`/i,
      /Do not invent a tone the owner\s+did not ask for/i,
      /includeRestricted/,
    ]);

    // The tool writes the wording; a body edited on the way past is wording nobody
    // reviewed, because the parent persists what the owner accepted.
    expect(instructions()).toMatch(/Relay variant bodies exactly as returned/i);
    expect(instructions()).toMatch(/wording nobody\s+reviewed/i);

    expect(instructions()).toMatch(/inherit nothing from the parent agent/i);
    expect(instructions()).toMatch(/never show a raw id/i);
  });

  it("exposes only a proposal tool with source grounding and no durable draft imports", () => {
    const tool = readFileSync(join(subagentRoot, "tools/propose_message_draft.ts"), "utf8");
    expect(tool).toContain("proposeDraft");
    expect(tool).toContain("resolveOwnerUserId");
    expect(tool).toContain("withModelSafeStoreErrors");
    expect(tool).toContain("revisionContext");
    expect(tool).toContain("sourceRefs");
    expect(tool).toMatch(/id:\s*sourceRef\.id/);
    const imports = [...tool.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).not.toContain("@tendnote/db/queries/drafts");
    expect(imports).not.toEqual(expect.arrayContaining(["@tendnote/db/queries/gmail-drafts"]));
    expect(tool).not.toMatch(/\b(generateDraft|createDraft|saveDraft|save_draft_to_gmail)\s*\(/);
  });
});
