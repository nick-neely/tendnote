import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const toolsDir = join(process.cwd(), "agent/tools");

function readTool(name: string): string {
  return readFileSync(join(toolsDir, `${name}.ts`), "utf8");
}

const toolFiles = readdirSync(toolsDir).filter((file) => file.endsWith(".ts"));
const instructions = readFileSync(join(process.cwd(), "agent/instructions.md"), "utf8");

describe("Phase 1A assistant tools are thin wrappers over shared functions", () => {
  const wrappers: Record<string, string> = {
    capture_source_record: "captureSourceRecord",
    capture_memory: "captureExplicitMemory",
    search_people: "searchPeople",
    get_person_context: "getPersonContext",
    get_suggested_memory_review: "getSuggestedMemoryReview",
    approve_suggested_memory: "saveSuggestedMemory",
    dismiss_suggested_memory: "dismissSuggestedMemory",
  };

  for (const [tool, sharedFn] of Object.entries(wrappers)) {
    it(`${tool} calls the shared @tendnote/db function ${sharedFn}`, () => {
      const source = readTool(tool);
      expect(source).toMatch(/from\s+"@tendnote\/db"/);
      expect(source).toContain(sharedFn);
    });
  }
});

describe("suggested-memory review tools return persisted ids and status", () => {
  it("get_suggested_memory_review returns the persisted component and memory id", () => {
    const source = readTool("get_suggested_memory_review");
    expect(source).toContain("component");
    expect(source).toMatch(/review\.memory\.id|memory:\s*\{/);
  });

  it("approve_suggested_memory returns the new status and persisted ids", () => {
    const source = readTool("approve_suggested_memory");
    expect(source).toMatch(/status:\s*result\.memory\.status/);
    expect(source).toContain("sourceRecordId");
    expect(source).toContain("component");
  });

  it("dismiss_suggested_memory returns the new status and persisted ids", () => {
    const source = readTool("dismiss_suggested_memory");
    expect(source).toMatch(/status:\s*memory\.status/);
    expect(source).toContain("sourceRecordId");
  });
});

describe("context-aware capture", () => {
  it("capture_source_record links a known person via the shared function and enqueues extraction", () => {
    const source = readTool("capture_source_record");
    expect(source).toContain("captureSourceRecordForPerson");
    expect(source).toContain("enqueueExtractionJob");
    expect(source).toMatch(/personId/);
  });
});

describe("instructions steer capture vs save vs review", () => {
  it("distinguishes casual capture from explicit memory and disambiguation", () => {
    expect(instructions).toMatch(/capture_source_record/);
    expect(instructions).toMatch(/capture_memory/);
    expect(instructions).toMatch(/disambiguate/i);
    expect(instructions).toMatch(/[Nn]ever invent a durable fact/);
  });

  it("names the review tools and frames suggestions as tentative until approved", () => {
    expect(instructions).toMatch(/get_suggested_memory_review/);
    expect(instructions).toMatch(/approve_suggested_memory/);
    expect(instructions).toMatch(/dismiss_suggested_memory/);
    expect(instructions).toMatch(/tentative until the user approves/i);
  });

  it("treats persisted ids, not conversation, as the source of truth", () => {
    expect(instructions).toMatch(/persisted record ids/i);
    expect(instructions).toMatch(/not the source of truth/i);
  });
});

describe("tools do not bypass owner scoping or scope/sensitivity rules", () => {
  // Tools that perform owner-scoped reads/writes (everything except the
  // owner-agnostic people search).
  const ownerScopedTools = toolFiles.filter((file) => file !== "search_people.ts");

  for (const file of ownerScopedTools) {
    it(`${file} resolves the owner via the shared helper instead of trusting input`, () => {
      const source = readFileSync(join(toolsDir, file), "utf8");
      expect(source).toContain("resolveOwnerUserId(ctx)");
      // Owner id is never accepted from tool input.
      expect(source).not.toMatch(/ownerUserId:\s*input\./);
    });
  }

  for (const file of toolFiles) {
    it(`${file} does not set a non-private scope (defers to the shared private default)`, () => {
      const source = readFileSync(join(toolsDir, file), "utf8");
      expect(source).not.toMatch(/scope:\s*["']?(shared|household)/);
    });
  }
});
