import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const instructions = readFileSync(join(process.cwd(), "agent/instructions/base.md"), "utf8");

const outboundActionPatterns = [
  /send\s+(an?\s+)?(email|text|message)/i,
  /create\s+(an?\s+)?(gmail|external)\s+draft/i,
  /post\s+to\s+(slack|telegram)/i,
];

describe("no-send-without-approval", () => {
  it("keeps the approval gate in the core instructions", () => {
    expect(instructions).toMatch(
      /Never send an email, text, or message without explicit approval\./,
    );
  });

  it("does not expose outbound action tools in phase 0", () => {
    const toolNames = readdirSync(join(process.cwd(), "agent/tools")).filter((fileName) =>
      fileName.endsWith(".ts"),
    );

    for (const toolName of toolNames) {
      expect(outboundActionPatterns.some((pattern) => pattern.test(toolName))).toBe(false);
    }
  });
});
