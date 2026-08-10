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

  it("the household tools add no channel, no delivery, and no external reach", () => {
    // Phase Eight's whole delivery contract in one assertion: a Household surface
    // is in-app and caller-scoped, so the tools that read or write one may not
    // import a provider, a mailer, a push sender, or the Discord channel. Household
    // email, a shared channel, cross-member push, and autonomous sends are all
    // absent because there is nothing here that could perform one (ADR 0220).
    const householdTools = ["household_check_in.ts", "search_gift_plans.ts", "add_gift_idea.ts"];

    for (const fileName of householdTools) {
      const source = readFileSync(join(process.cwd(), "agent/tools", fileName), "utf8");
      const importSources = [...source.matchAll(/from\s+"([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      for (const moduleId of importSources) {
        expect(moduleId).not.toMatch(
          /gmail|mail|discord|push|notification|provider|sendgrid|twilio|slack|resend|channel/i,
        );
      }
      // And nothing reaches another member: no tool takes a user id, a household
      // id, or a recipient. The caller's own session is the only identity here.
      expect(source).not.toMatch(/\b(recipientUserId|memberUserId|householdId:\s*z\.)/);
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
