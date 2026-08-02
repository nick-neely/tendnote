import { describe, expect, it } from "vitest";
import {
  contextFactCategorySchema,
  contextFactSchema,
  contextFactSubjectSchema,
  createSelfContextFactInputSchema,
} from "./context-facts";

describe("Context Fact domain contract", () => {
  it("keeps the fixed categories and explicit subject union closed", () => {
    expect(contextFactCategorySchema.options).toEqual([
      "background",
      "work",
      "location",
      "interest",
      "preference",
      "constraint",
      "composition",
      "other",
    ]);
    expect(contextFactSubjectSchema.safeParse({ kind: "self", userId: "user-1" }).success).toBe(
      true,
    );
    expect(
      contextFactSubjectSchema.safeParse({
        kind: "self",
        userId: "user-1",
        householdId: "household-1",
      }).success,
    ).toBe(false);
  });

  it("rejects Composition for Self Context at the shared schema seam", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    expect(
      contextFactSchema.safeParse({
        id: "fact-1",
        subject: { kind: "self", userId: "user-1" },
        category: "composition",
        content: "Invalid self composition",
        lifecycle: "active",
        sensitivity: "normal",
        provenance: { channel: "account", origin: "direct", sourceRecordId: null },
        suggestionEvidence: null,
        creatorUserId: "user-1",
        lastActorUserId: "user-1",
        reviewedAt: now,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(false);
  });

  it("does not allow direct Self writes to smuggle authority fields or ambient provenance", () => {
    expect(
      createSelfContextFactInputSchema.safeParse({
        callerUserId: "user-1",
        category: "work",
        content: "I run a consultancy.",
        authority: "system",
      }).success,
    ).toBe(false);
    expect(
      createSelfContextFactInputSchema.safeParse({
        callerUserId: "user-1",
        category: "work",
        content: "I run a consultancy.",
        provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      }).success,
    ).toBe(false);
  });

  it("keeps provenance channel and origin aligned", () => {
    expect(
      contextFactSchema.shape.provenance.safeParse({
        channel: "ambient",
        origin: "direct",
        sourceRecordId: null,
      }).success,
    ).toBe(false);
    expect(
      contextFactSchema.shape.provenance.safeParse({
        channel: "account",
        origin: "ambient",
        sourceRecordId: null,
      }).success,
    ).toBe(false);
    expect(
      contextFactSchema.shape.provenance.safeParse({
        channel: "ambient",
        origin: "ambient",
        sourceRecordId: "message-1",
      }).success,
    ).toBe(true);
  });
});
