import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateDraft, persistAcceptedDraftProposal } = vi.hoisted(() => ({
  generateDraft: vi.fn(),
  persistAcceptedDraftProposal: vi.fn(),
}));

vi.mock("@tendnote/db/queries/drafts", () => ({ generateDraft }));
vi.mock("@tendnote/db/queries/draft-proposals", () => ({ persistAcceptedDraftProposal }));

const { default: tool } = await import("../agent/tools/create_message_draft");

const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const DRAFT_ID = "22222222-2222-2222-2222-222222222222";

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

function createdDraft() {
  return {
    status: "created" as const,
    draft: {
      id: DRAFT_ID,
      personId: PERSON_ID,
      channel: "text",
      purpose: "check_in",
      status: "draft",
      body: "Hi Mark — heard you moved to Denver, how's it going?",
      sourceRefs: [
        { kind: "approved_memory", id: "m1", label: "Moved to Denver", trust: "confirmed_fact" },
        { kind: "suggested_memory", id: "m2", label: "Maybe runs marathons", trust: "tentative" },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe("create_message_draft tool", () => {
  it("persists via the shared generator and returns a persisted-draft component", async () => {
    generateDraft.mockResolvedValue(createdDraft());

    const result = await tool.execute({ personId: PERSON_ID, purpose: "check_in" }, ctx);

    // Owner scoping: the resolved principal is threaded into the generator.
    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-1", personId: PERSON_ID, purpose: "check_in" }),
    );
    expect(result.created).toBe(true);
    if (!result.created) return;
    // Component references the PERSISTED draft, not unpersisted model output.
    expect(result.component).toEqual({ type: "message_draft", draftId: DRAFT_ID });
    expect(result.draft.body).toContain("Denver");
    // Grounding is exposed by trust tier with labels only — never raw ids.
    expect(result.grounding).toEqual([
      { trust: "confirmed_fact", label: "Moved to Denver" },
      { trust: "tentative", label: "Maybe runs marathons" },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("m1");
    expect(serialized).not.toContain("m2");
  });

  it("passes follow-up grounding and tone through to the generator", async () => {
    generateDraft.mockResolvedValue(createdDraft());

    await tool.execute(
      {
        personId: PERSON_ID,
        toneInstruction: "warmer",
        followupContext: {
          id: "33333333-3333-3333-3333-333333333333",
          reason: "check in after the move",
        },
      },
      ctx,
    );

    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        toneInstruction: "warmer",
        followupContext: {
          id: "33333333-3333-3333-3333-333333333333",
          reason: "check in after the move",
        },
      }),
    );
  });

  it("persists an accepted Draft Proposal body without regenerating it", async () => {
    persistAcceptedDraftProposal.mockResolvedValue(createdDraft());

    const result = await tool.execute(
      {
        personId: PERSON_ID,
        purpose: "check_in",
        acceptedProposal: {
          body: "Exact accepted proposal body.",
          sourceRefs: [
            {
              kind: "approved_memory",
              id: "memory-1",
              label: "Moved to Denver",
              trust: "confirmed_fact",
            },
          ],
        },
      },
      ctx,
    );

    expect(result.created).toBe(true);
    expect(generateDraft).not.toHaveBeenCalled();
    expect(persistAcceptedDraftProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        personId: PERSON_ID,
        body: "Exact accepted proposal body.",
        sourceRefs: [
          {
            kind: "approved_memory",
            id: "memory-1",
            label: "Moved to Denver",
            trust: "confirmed_fact",
          },
        ],
      }),
    );
  });

  it("keeps restricted content out unless explicitly requested", async () => {
    generateDraft.mockResolvedValue(createdDraft());

    await tool.execute({ personId: PERSON_ID }, ctx);
    expect(generateDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ directlyRequested: false }),
    );

    await tool.execute({ personId: PERSON_ID, includeRestricted: true }, ctx);
    expect(generateDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ directlyRequested: true }),
    );
  });

  it("declines (no draft) when the person can't be resolved", async () => {
    generateDraft.mockResolvedValue({ status: "skipped", reason: "person_not_found" });

    const result = await tool.execute({ personId: PERSON_ID }, ctx);

    expect(result.created).toBe(false);
    if (result.created) return;
    expect(result.reason).toBe("person_not_found");
    expect(result.guidance).toMatch(/resolve|disambiguat|search_people/i);
  });

  it("declines without inventing when context is too thin", async () => {
    generateDraft.mockResolvedValue({ status: "skipped", reason: "insufficient_context" });

    const result = await tool.execute({ personId: PERSON_ID }, ctx);

    expect(result.created).toBe(false);
    if (result.created) return;
    expect(result.guidance).toMatch(/capture a note|clarif|do not invent/i);
  });

  it("gives adapter-failure-specific guidance, not a thin-context message", async () => {
    generateDraft.mockResolvedValue({ status: "skipped", reason: "generation_failed" });

    const result = await tool.execute({ personId: PERSON_ID }, ctx);

    expect(result.created).toBe(false);
    if (result.created) return;
    expect(result.reason).toBe("generation_failed");
    expect(result.guidance).toMatch(/unavailable|try again|failed/i);
    expect(result.guidance).not.toMatch(/not enough grounded context/i);
  });

  it("imports no external send/draft/provider module — only the shared generator", () => {
    // Behavioral boundary (PRD #75): the Eve draft tool persists a Tendnote-only
    // record and must never reach an external send, Gmail/provider draft, or MCP
    // provider. Scan the tool's IMPORTS (not its boundary-affirming prose) so the
    // description can still say "never creates a Gmail draft" without tripping this.
    const source = readFileSync(join(process.cwd(), "agent/tools/create_message_draft.ts"), "utf8");
    const importSources = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

    for (const moduleId of importSources) {
      expect(moduleId).not.toMatch(/gmail|mcp|nodemailer|provider|sendgrid|twilio|slack|resend/i);
    }
    // The only data dependencies are the shared Tendnote draft generator and
    // accepted-proposal persister — no provider client.
    expect(importSources).toContain("@tendnote/db/queries/drafts");
    expect(importSources).toContain("@tendnote/db/queries/draft-proposals");
  });
});
