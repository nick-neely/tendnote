import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const toolSource = readFileSync(join(process.cwd(), "agent/tools/get_person_context.ts"), "utf8");
const instructions = readFileSync(join(process.cwd(), "agent/instructions.md"), "utf8");

describe("trust-aware person context tool", () => {
  it("calls the shared owner-scoped retrieval rather than re-deriving policy", () => {
    expect(toolSource).toMatch(/import\s+\{[^}]*getPersonContext[^}]*\}\s+from\s+"@tendnote\/db"/);
  });

  it("returns the three trust tiers as distinct keys", () => {
    for (const key of ["approvedMemories", "sourceRecords", "suggestedMemories"]) {
      expect(toolSource).toContain(key);
    }
  });

  it("steers phrasing in the tool description and guidance block", () => {
    expect(toolSource).toMatch(/CONFIRMED FACTS/);
    expect(toolSource).toMatch(/LOGGED CONTEXT/);
    expect(toolSource).toMatch(/you noted|you mentioned/i);
    expect(toolSource).toMatch(/TENTATIVE/);
  });

  it("keeps restricted context gated behind a direct request", () => {
    expect(toolSource).toMatch(/includeRestricted/);
    expect(toolSource).toMatch(/directlyRequested/);
  });
});

describe("instructions steer trust-aware phrasing", () => {
  it("distinguishes approved facts, logged context, and tentative suggestions", () => {
    expect(instructions).toMatch(/Approved memories\*\* are confirmed facts/i);
    expect(instructions).toMatch(/you noted.*you mentioned/i);
    expect(instructions).toMatch(/Suggested memories\*\* are tentative/i);
  });
});
