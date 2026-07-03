import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authoredInstructions } from "./instructions-source";

const toolSource = readFileSync(join(process.cwd(), "agent/tools/get_person_context.ts"), "utf8");
// Trust-tier phrasing spans always-on base.md plus recall skill guidance.
const instructions = authoredInstructions();

describe("trust-aware person context tool", () => {
  it("calls the shared snapshot-backed read path rather than re-deriving policy", () => {
    expect(toolSource).toMatch(
      /import\s+\{[^}]*getPersonContextSnapshot[^}]*\}\s+from\s+"@tendnote\/db(\/[\w-]+)*"/,
    );
    expect(toolSource).toMatch(/getPersonContextSnapshot\(/);
  });

  it("does not own snapshot generation, freshness, or persistence", () => {
    // Eve consumes the shared contract; it must not build/persist snapshots itself.
    expect(toolSource).not.toMatch(/generateDeterministicSnapshot|upsertContextSnapshot/);
  });

  it("returns the snapshot summary plus the three trust tiers as distinct keys", () => {
    for (const key of ["snapshot", "approvedMemories", "sourceRecords", "suggestedMemories"]) {
      expect(toolSource).toContain(key);
    }
  });

  it("surfaces compact follow-up context", () => {
    expect(toolSource).toMatch(/followups/);
  });

  it("steers the model to treat the snapshot as cache, not source of truth", () => {
    expect(toolSource).toMatch(/cache/i);
    expect(toolSource).toMatch(/not a source of truth|NOT a source of truth/i);
    expect(toolSource).toMatch(/ground/i);
  });

  it("steers phrasing in the tool description and guidance block", () => {
    expect(toolSource).toMatch(/CONFIRMED FACTS/);
    expect(toolSource).toMatch(/LOGGED CONTEXT/);
    expect(toolSource).toMatch(/you noted|you mentioned/i);
    expect(toolSource).toMatch(/TENTATIVE/);
  });

  it("keeps restricted context gated behind a direct request and out of the cache", () => {
    expect(toolSource).toMatch(/includeRestricted/);
    expect(toolSource).toMatch(/directlyRequested/);
  });

  it("fails open to the supporting records when the snapshot is unavailable", () => {
    // On fallback the snapshot is null; the context tiers are always returned.
    expect(toolSource).toMatch(/status !== "fallback"|fallback/);
    expect(toolSource).toMatch(/snapshot:\s*\n?\s*snapshot/);
  });
});

describe("instructions steer trust-aware phrasing", () => {
  it("distinguishes approved facts, logged context, and tentative suggestions", () => {
    expect(instructions).toMatch(/Approved memories\*\* are confirmed facts/i);
    expect(instructions).toMatch(/you noted.*you mentioned/i);
    expect(instructions).toMatch(/Suggested memories\*\* are tentative/i);
  });

  it("steers the agent to treat snapshots as cache, not source of truth", () => {
    expect(instructions).toMatch(/Snapshot\*\* is a generated summary cache/i);
    expect(instructions).toMatch(/not a source of truth/i);
    expect(instructions).toMatch(/ground the claim in the supporting records/i);
  });

  it("distinguishes private, selected-member, and household visibility provenance", () => {
    expect(instructions).toMatch(/Only me.*private note/i);
    expect(instructions).toMatch(/Specific people.*selected-member shared context/i);
    expect(instructions).toMatch(/Whole household.*household context/i);
    expect(instructions).toMatch(/another member's private records/i);
  });
});
