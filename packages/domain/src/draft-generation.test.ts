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
});
