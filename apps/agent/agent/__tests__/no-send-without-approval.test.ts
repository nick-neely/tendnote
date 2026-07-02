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

  it("the draft tool stays Tendnote-only: it persists a draft and never sends or drafts externally", () => {
    // Phase 1G adds a drafting tool; the no-send guarantee now covers it explicitly.
    const draftTool = readFileSync(
      join(process.cwd(), "agent/tools/create_message_draft.ts"),
      "utf8",
    );
    const importSources = [...draftTool.matchAll(/from\s+"([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );

    // Its only data dependency is the shared internal draft generator — no provider.
    expect(importSources).toContain("@tendnote/db/queries/drafts");
    for (const moduleId of importSources) {
      expect(moduleId).not.toMatch(/gmail|mcp|nodemailer|provider|sendgrid|twilio|slack|resend/i);
    }
    // Its description tells the model it never sends or creates an external/Gmail draft.
    expect(draftTool).toMatch(/never sends a message, creates a gmail or external draft/i);
  });
});
