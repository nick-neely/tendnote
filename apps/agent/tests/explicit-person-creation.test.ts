import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authoredInstructions } from "./instructions-source";

const toolsDir = join(process.cwd(), "agent/tools");
// "# Adding people" guidance now lives in the capturing-and-review skill.
const instructions = authoredInstructions();

function readTool(name: string): string {
  return readFileSync(join(toolsDir, `${name}.ts`), "utf8");
}

function expectMatches(source: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    expect(source).toMatch(pattern);
  }
}

describe("explicit person creation (issue #22)", () => {
  it("exposes exactly one person-creating tool, and it is create_person", () => {
    const toolFiles = readdirSync(toolsDir).filter((file) => file.endsWith(".ts"));
    const personCreators = toolFiles.filter((file) => /create.*person|add.*person/i.test(file));

    expect(personCreators).toEqual(["create_person.ts"]);
  });

  it("requires explicit intent and a search-first/disambiguate contract in the create_person tool", () => {
    const source = readTool("create_person");

    // Explicit-intent-only and search-first are stated in the tool description so
    // a casual or ambiguous mention never reaches it.
    expect(source).toMatch(/explicit/i);
    expect(source).toMatch(/search/i);
    expect(source).toMatch(/disambiguat/i);
  });

  it("routes creation through the shared owner-scoped createPerson mutation", () => {
    const source = readTool("create_person");

    expect(source).toMatch(/from\s+"@tendnote\/db(\/[\w-]+)*"/);
    expect(source).toContain("createPerson");
    expect(source).toContain("resolveOwnerUserId");
  });

  it("instructs the agent to search first, disambiguate, and never auto-create from a casual mention", () => {
    expectMatches(instructions, [
      /# Adding people/,
      /# Global Capture takes precedence/,
      /call `capture_saved_item` \*\*exactly once\*\*/,
      /even when the user does not say the word Capture/i,
      /multiple explicit clauses stay together in that one call/,
      /do not search or propose\s+separately/i,
      /search_people/,
      /explicit add-person intent outside Global Capture/i,
      /Inside Global Capture, use\s+`capture_saved_item` instead/i,
      /more than one candidate/i,
      /do not create a person/i,
      /never a reason to grow the people list/i,
    ]);
  });

  it("keeps destination-specific tools outside Global Capture", () => {
    for (const toolName of ["create_person", "capture_memory", "propose_asset_memories"]) {
      const source = readTool(toolName);
      expectMatches(source, [/outside Global Capture/i, /capture_saved_item.*owns that path/is]);
    }

    const captureSource = readTool("capture_saved_item");
    expectMatches(captureSource, [
      /GLOBAL CAPTURE PRECEDENCE/,
      /call this tool exactly once/i,
      /Do not fan that request out to create_person, capture_memory, search_assets, or propose_asset_memories/,
    ]);
  });
});
