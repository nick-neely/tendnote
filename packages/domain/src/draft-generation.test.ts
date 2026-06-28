import { describe, expect, it } from "vitest";
import {
  buildDraftPrompt,
  type DraftGroundedContext,
  generateDeterministicDraft,
  hasGroundedDraftContext,
} from "./draft-generation";

function context(overrides: Partial<DraftGroundedContext> = {}): DraftGroundedContext {
  return {
    person: { displayName: "Mark Lee", relationshipType: "friend" },
    channel: "text",
    purpose: "check_in",
    facts: [],
    loggedContext: [],
    tentative: [],
    ...overrides,
  };
}

describe("hasGroundedDraftContext", () => {
  it("is true with a confirmed fact, logged context, follow-up, or brief reason", () => {
    expect(hasGroundedDraftContext(context({ facts: ["Moved to Denver"] }))).toBe(true);
    expect(hasGroundedDraftContext(context({ loggedContext: ["Talked about work"] }))).toBe(true);
    expect(hasGroundedDraftContext(context({ followupReason: "check in" }))).toBe(true);
    expect(hasGroundedDraftContext(context({ briefReason: "birthday soon" }))).toBe(true);
  });

  it("is false when only tentative hints (or nothing) are present", () => {
    expect(hasGroundedDraftContext(context({ tentative: ["Might like jazz"] }))).toBe(false);
    expect(hasGroundedDraftContext(context())).toBe(false);
  });
});

describe("generateDeterministicDraft", () => {
  it("references a confirmed fact and never invents one", () => {
    const result = generateDeterministicDraft(context({ facts: ["Just moved to Denver"] }));

    expect(result.body).toContain("Mark");
    expect(result.body.toLowerCase()).toContain("just moved to denver");
    expect(result.provenance.generator).toBe("deterministic");
  });

  it("never asserts tentative hints as fact", () => {
    const result = generateDeterministicDraft(
      context({ facts: ["Loves hiking"], tentative: ["Might be getting a dog"] }),
    );

    expect(result.body).not.toContain("dog");
    expect(result.provenance.omittedTentative).toBe(1);
  });

  it("uses a birthday greeting for birthday drafts", () => {
    const result = generateDeterministicDraft(context({ purpose: "birthday" }));

    expect(result.body).toContain("Happy birthday, Mark!");
  });

  it("leads with the follow-up reason when present", () => {
    const result = generateDeterministicDraft(
      context({ followupReason: "you just started a new job" }),
    );

    expect(result.body.toLowerCase()).toContain("you just started a new job");
  });
});

describe("buildDraftPrompt", () => {
  it("encodes the Tendnote-only, no-fake-memory, trust-tier rules", () => {
    const prompt = buildDraftPrompt(
      context({
        facts: ["Moved to Denver"],
        loggedContext: ["Talked about a trip"],
        tentative: ["Might like jazz"],
      }),
    );

    expect(prompt).toContain("Tendnote-only");
    expect(prompt).toContain("Do not invent facts");
    expect(prompt.toLowerCase()).toContain("never as fact");
    expect(prompt).toContain("Confirmed facts");
    expect(prompt).toContain("Logged context");
    expect(prompt).toContain("Tentative");
  });

  it("does not leak the tentative section when there are no tentative hints", () => {
    const prompt = buildDraftPrompt(context({ facts: ["Moved to Denver"] }));

    expect(prompt).not.toContain("Tentative (unconfirmed) hints");
  });

  it("allows light Markdown for an email draft but keeps text/chat plain", () => {
    const email = buildDraftPrompt(context({ channel: "email", facts: ["Moved to Denver"] }));
    expect(email).toMatch(/light Markdown/i);

    const text = buildDraftPrompt(context({ channel: "text", facts: ["Moved to Denver"] }));
    expect(text).toMatch(/no Markdown formatting/i);
    expect(text).not.toMatch(/light Markdown/i);
  });

  it("passes a tone request through to the model", () => {
    const prompt = buildDraftPrompt(
      context({ facts: ["Moved to Denver"], toneInstruction: "warmer and shorter" }),
    );

    expect(prompt).toContain("Tone request: warmer and shorter");
  });
});

// CI-safe model-behavior evals (PRD #75 testing decisions): the deterministic
// generator stands in for the model so tone, no-fake-memory, and source-grounding
// are enforced without live credentials. Live-model evals are credential-gated.
describe("draft behavior evals (deterministic, no live model)", () => {
  // Greeting-card / fake-warmth phrasing the drafts must avoid (tone match).
  const CLICHES = [
    "hope this finds you well",
    "just wanted to reach out",
    "thinking of you always",
    "warmest wishes",
    "near and dear",
  ];

  it("tone match (prompt): instructs the model toward concise, non-fake-sentimental prose", () => {
    // The real tone lever for a live model is the prompt — assert it explicitly
    // steers away from greeting-card warmth and toward a concise, natural note.
    const prompt = buildDraftPrompt(context({ facts: ["Just moved to Denver"] }));
    expect(prompt).toMatch(/concise and natural/i);
    expect(prompt).toMatch(/greeting card/i);
    expect(prompt).toMatch(/fake sentimentality/i);
  });

  it("tone match (deterministic): the fallback body stays clean and concise", () => {
    const result = generateDeterministicDraft(
      context({ facts: ["Just moved to Denver"], followupReason: "check in after the move" }),
    );
    const lower = result.body.toLowerCase();
    for (const cliche of CLICHES) {
      expect(lower).not.toContain(cliche);
    }
    // Concise by default: a short note, not a paragraph wall.
    expect(result.body.length).toBeLessThan(320);
  });

  it("no fake memory: the body contains only grounding that was provided", () => {
    const result = generateDeterministicDraft(
      context({
        facts: ["Just adopted a rescue dog named Biscuit"],
        tentative: ["Maybe changing jobs soon"],
      }),
    );
    // Confirmed fact may appear; the unconfirmed hint must not be asserted.
    expect(result.body).toContain("Biscuit");
    expect(result.body.toLowerCase()).not.toContain("job");
  });

  it("source-grounded: approved memory is referenced as a fact", () => {
    const result = generateDeterministicDraft(context({ facts: ["is training for a marathon"] }));
    expect(result.body.toLowerCase()).toContain("training for a marathon");
  });

  it("source-grounded: source-record context is used when there is no confirmed fact", () => {
    const result = generateDeterministicDraft(
      context({ loggedContext: ["a recent trip to Japan"] }),
    );
    expect(result.body.toLowerCase()).toContain("a recent trip to japan");
  });

  it("source-grounded: a follow-up reason drives the outreach", () => {
    const result = generateDeterministicDraft(
      context({ followupReason: "see how the new apartment is" }),
    );
    expect(result.body.toLowerCase()).toContain("see how the new apartment is");
  });

  it("source-grounded: a brief-item reason drives the outreach", () => {
    const result = generateDeterministicDraft(
      context({ briefReason: "it has been three months since you last spoke" }),
    );
    expect(result.body.toLowerCase()).toContain("three months since you last spoke");
  });

  it("thin context: refuses (no grounding) rather than inventing", () => {
    // Suggested-only / empty context is not enough to justify a draft.
    expect(hasGroundedDraftContext(context({ tentative: ["Might like jazz"] }))).toBe(false);
    expect(hasGroundedDraftContext(context())).toBe(false);
  });
});
