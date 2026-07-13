import { describe, expect, it } from "vitest";
import { baseInstructions } from "./instructions-source";

/**
 * Eve chat plus-menu Asset Evidence capture boundary (#201, PRD #196). Phase 6
 * gives chat a capture *entry point* — camera / photo library / file routed
 * into the shared, review-gated Asset Evidence flow — and deliberately nothing
 * more. Eve never receives file contents, so it must not present OCR, receipt
 * parsing, arbitrary file Q&A, a document inbox, or general multimodal memory
 * as available, and must not grow a separate chat attachment model. Always-on
 * behavior, so it lives in base.md, not a skill.
 */

const base = baseInstructions();

describe("asset evidence capture instructions (#201)", () => {
  it("routes chat uploads to the plus-menu's shared Asset Evidence capture", () => {
    expect(base).toMatch(/plus-menu/i);
    expect(base).toMatch(/asset evidence/i);
    expect(base).toMatch(/asset review item|review item/i);
  });

  it("keeps evidence out of the conversation — no chat attachment model", () => {
    expect(base).toMatch(/never into the conversation|not.*chat attachment/i);
  });

  it("denies file-content reading: no OCR, file Q&A, or document inbox in this phase", () => {
    expect(base).toMatch(/never receive[s]? .*file contents|cannot see .*file contents/i);
    expect(base).toMatch(/OCR/);
    expect(base).toMatch(/document inbox/i);
    expect(base).toMatch(/multimodal memory/i);
    expect(base).toMatch(/never claim to have (viewed|read|analyzed)/i);
  });
});
