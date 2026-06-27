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
    expect(instructions).toMatch(/# Adding people/);
    expect(instructions).toMatch(/search_people/);
    // Explicit add-person is the only path to a new person.
    expect(instructions).toMatch(/only way a new person is created/i);
    // Multiple candidates must be disambiguated, not guessed.
    expect(instructions).toMatch(/more than one candidate/i);
    // A casual/ambiguous mention must not grow the people list.
    expect(instructions).toMatch(/do not create a person/i);
    expect(instructions).toMatch(/never a reason to grow the people list/i);
  });
});
