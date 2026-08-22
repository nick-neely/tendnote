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

  it("makes the multi-clause precedence concrete for cross-domain captures", () => {
    const captureSource = readTool("capture_saved_item");

    expectMatches(instructions, [
      /A message with two or more supported explicit clauses is one Global Capture request/i,
      /Add Priya; remember that Priya prefers oat milk; and track asset refrigerator water filter/i,
      /call `capture_saved_item` before any destination-specific tool/i,
      /do not ask which destination.*before calling `capture_saved_item`/i,
    ]);
    expectMatches(captureSource, [
      /If the user's message contains two or more supported explicit clauses/i,
      /call capture_saved_item exactly once before any destination-specific tool/i,
      /Do not ask which destination.*before calling capture_saved_item/i,
      /Keep every explicit requested clause only in originalText/i,
      /never copy it into inferredSuggestions/i,
    ]);
    expectMatches(instructions, [
      /inferredSuggestions.*only for a secondary interpretation/is,
      /remember that Priya prefers oat milk; track the refrigerator filter[\s\S]*omits `inferredSuggestions`/i,
      /Resolving a Person or Asset before Capture does not turn an explicit clause into an inference/i,
    ]);
  });
});
