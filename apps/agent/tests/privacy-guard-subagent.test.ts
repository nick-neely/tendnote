import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authoredInstructions } from "./instructions-source";

const subagentRoot = join(process.cwd(), "agent/subagents/privacy_guard");
const toolsRoot = join(subagentRoot, "tools");

/**
 * Tools the reviewer actually has. An empty `tools/` directory is not the same
 * as no directory at all: Eve gives every agent node its own copy of the default
 * harness, so Privacy Guard's `tools/` holds the files that turn those defaults
 * off, and only a file that does something else would be a tool.
 */
function authoredToolFiles(): string[] {
  if (!existsSync(toolsRoot)) return [];
  return readdirSync(toolsRoot).filter(
    (file) => !/export default disableTool\(\)/.test(readFileSync(join(toolsRoot, file), "utf8")),
  );
}

describe("Privacy Guard subagent", () => {
  it("is declared as a reviewer-only household privacy specialist", () => {
    const source = readFileSync(join(subagentRoot, "agent.ts"), "utf8");

    expect(source).toContain("defineAgent");
    expect(source).toMatch(/reviewer-only/i);
    expect(source).toMatch(/household scope/i);
    expect(authoredInstructions()).toMatch(/privacy_guard/);
    expect(authoredInstructions()).toMatch(/deterministic policy wins/i);
  });

  it("has isolated instructions that block access-policy decisions and extra context", () => {
    const instructions = readFileSync(join(subagentRoot, "instructions.md"), "utf8");

    expect(instructions).toMatch(/reviewer-only/i);
    expect(instructions).toMatch(/after deterministic scope enforcement/i);
    expect(instructions).toMatch(/must not decide access/i);
    expect(instructions).toMatch(/must not add records, context, tools, or actions/i);
    expect(instructions).toMatch(/deterministic\s+policy wins/i);
  });

  it("pins the authored Privacy Guard surface covered by reviewer-only checks", () => {
    const authoredFiles = [
      "agent/subagents/privacy_guard/agent.ts",
      "agent/subagents/privacy_guard/instructions.md",
    ];

    expect(
      authoredFiles.map((file) => readFileSync(join(process.cwd(), file), "utf8")).length,
    ).toBe(2);
    expect(authoredToolFiles()).toEqual([]);
  });

  it("has no tools or durable data imports", () => {
    expect(authoredToolFiles()).toEqual([]);

    const combined = [
      readFileSync(join(subagentRoot, "agent.ts"), "utf8"),
      readFileSync(join(subagentRoot, "instructions.md"), "utf8"),
    ].join("\n");

    expect(combined).not.toMatch(
      /\b(create|update|approve|dismiss|save|send|capture|search|get|list)_[a-z_]+\s*\(/,
    );
    expect(combined).not.toMatch(/@tendnote\/db\/queries/);
  });
});
