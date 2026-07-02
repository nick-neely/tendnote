import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCleanupPreview } from "./cleanup-preview";

const OWNER = "owner-1";

describe("Cleanup Preview workflow", () => {
  it("parses and normalizes messy CSV input into review-only candidates", () => {
    const preview = createCleanupPreview({
      ownerUserId: OWNER,
      inputKind: "csv",
      source: "sandbox",
      inputText: [
        "name,email,phone,birthday,note,followup",
        "Maya,maya@example.com,(555) 111-2222,7/20,Met at the design meetup,Ask about portfolio launch",
      ].join("\n"),
    });

    expect(preview.inputKind).toBe("csv");
    expect(preview.source).toBe("sandbox");
    expect(preview.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "person", value: "Maya", reviewOnly: true }),
        expect.objectContaining({ kind: "contact_method", value: "maya@example.com" }),
        expect.objectContaining({ kind: "memory", title: "Maya birthday" }),
        expect.objectContaining({ kind: "source_record", title: "Cleanup source record" }),
        expect.objectContaining({ kind: "followup", title: "Maya follow-up" }),
      ]),
    );
    expect(
      preview.candidates.every((candidate) => candidate.writesRequireExplicitConfirmation),
    ).toBe(true);
  });

  it("parses vCard, JSON, and pasted text inputs", () => {
    const vcard = createCleanupPreview({
      ownerUserId: OWNER,
      inputKind: "vcard",
      inputText:
        "BEGIN:VCARD\nN:Doe;Jane;;;\nEMAIL:jane@example.com\nTEL:+1 555 222 3333\nEND:VCARD",
    });
    const json = createCleanupPreview({
      ownerUserId: OWNER,
      inputKind: "json",
      inputText: JSON.stringify([{ name: "Owen", note: "Likes quiet coffee catchups" }]),
    });
    const text = createCleanupPreview({
      ownerUserId: OWNER,
      inputKind: "text",
      inputText: "Priya <priya@example.com>\nFollowup: ask about the residency application",
    });

    expect(vcard.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "person", value: "Jane Doe" }),
        expect.objectContaining({ kind: "contact_method" }),
      ]),
    );
    expect(json.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "memory" })]),
    );
    expect(text.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "followup" })]),
    );
    expect(text.candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "person", value: "ask about the residency application" }),
      ]),
    );
  });

  it("keeps malformed JSON reviewable as messy text", () => {
    const preview = createCleanupPreview({
      ownerUserId: OWNER,
      inputKind: "json",
      inputText: "{Maya maya@example.com",
    });

    expect(preview.inputKind).toBe("json");
    expect(preview.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "contact_method" })]),
    );
    expect(preview.candidates.every((candidate) => candidate.reviewOnly)).toBe(true);
  });

  it("dedupes normalized candidates in the preview output", () => {
    const preview = createCleanupPreview({
      ownerUserId: OWNER,
      inputKind: "text",
      inputText: "Maya maya@example.com\nMaya <MAYA@example.com>",
    });

    expect(preview.summary.duplicateCandidates).toBeGreaterThan(0);
    expect(
      preview.candidates.filter((candidate) => candidate.value === "maya@example.com"),
    ).toHaveLength(1);
  });

  it("keeps Google Contacts import and Discord attachments outside the cleanup input path", () => {
    expect(() =>
      createCleanupPreview({
        ownerUserId: OWNER,
        source: "discord_attachment",
        inputText: "Maya maya@example.com",
      }),
    ).toThrow("Discord attachments are not a cleanup preview input path.");

    const source = readFileSync(join(process.cwd(), "src/queries/cleanup-preview.ts"), "utf8");
    expect(source).not.toMatch(/contacts-import-preview|google/i);
  });

  it("does not import direct durable-write queries or external-send adapters", () => {
    const source = readFileSync(join(process.cwd(), "src/queries/cleanup-preview.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

    for (const moduleId of imports) {
      expect(moduleId).not.toMatch(/queries\/(people|memories|source-records|followups|drafts)/);
      expect(moduleId).not.toMatch(/sendgrid|twilio|slack|resend|nodemailer/i);
    }
    expect(source).not.toMatch(/\bgetDb\b|drizzle-orm|\.insert\(|\.delete\(/);
  });
});
