import { describe, expect, it } from "vitest";
import { DRAFT_REVISION_REPLY_CANONICAL } from "../agent/lib/response-contracts";
import { authoredInstructions, baseInstructions } from "./instructions-source";

// The whole authored surface (base.md + every skill), so a rule that lives in the
// drafting skill still counts as enforced guidance even if it later moves between
// base and a skill (see authoredInstructions).
const authored = authoredInstructions();
const base = baseInstructions();

describe("drafting instructions — tone and privacy", () => {
  it("requires concise, natural, non-fake-sentimental drafts", () => {
    expect(authored).toMatch(/concise and natural/i);
    expect(authored).toMatch(/greeting card/i);
    expect(authored).toMatch(/fake sentimentality/i);
  });

  it("preserves trust-tier distinctions when drafting", () => {
    expect(authored).toMatch(/confirmed facts/i);
    expect(authored).toMatch(/logged context/i);
    expect(authored).toMatch(/tentative/i);
  });

  it("forbids inventing personal facts to warm a message (no fake memory)", () => {
    expect(authored).toMatch(/no fake memory|never invent/i);
  });

  it("honors explicit tone requests rather than guessing", () => {
    expect(authored).toMatch(/warmer|shorter|more professional/i);
    expect(authored).toMatch(/toneInstruction/);
  });

  it("routes exploratory drafting through ephemeral Draft Proposals before persistence", () => {
    expect(authored).toMatch(/message_drafter/);
    expect(authored).toMatch(/ephemeral Draft Proposals/i);
    expect(authored).toMatch(/revisionContext/);
    expect(authored).toMatch(/acceptedProposal/);
    expect(authored).toMatch(/saved draft matches what the owner accepted/i);
  });
});

describe("drafting instructions — no external send or draft", () => {
  it("keeps the always-on approval gate in base instructions", () => {
    expect(base).toMatch(/Never send an email, text, or message without explicit approval\./);
  });

  it("states drafting stays inside Tendnote with no external send or draft", () => {
    expect(authored).toMatch(/inside Tendnote/i);
    expect(authored).toMatch(/never send/i);
    expect(authored).toMatch(/gmail|external draft/i);
  });

  it("frames approving a draft as internal readiness, not a send", () => {
    expect(authored).toMatch(/internal readiness/i);
    expect(authored).toMatch(/not.*send|never.*sent/i);
  });

  it("keeps an edit internal and explicitly unapproved", () => {
    expect(authored).toMatch(/internal, text-only change/i);
    expect(authored).toMatch(/remains an unapproved Tendnote draft/i);
    expect(authored).toMatch(/never call it ready to send/i);
    expect(authored).toMatch(/external or Gmail draft/i);
  });

  it("keeps the status-dependent edit confirmations aligned with the evaluator contract", () => {
    expect(authored).toContain(DRAFT_REVISION_REPLY_CANONICAL.draft);
    expect(authored).toContain(DRAFT_REVISION_REPLY_CANONICAL.approved);
  });
});
