import { describe, expect, it } from "vitest";
import {
  contextFactCategorySchema,
  contextFactSchema,
  contextFactSubjectSchema,
  createSelfContextFactInputSchema,
  isDuplicateContextFact,
  isLikelyConflictingContextFact,
  normalizeContextFactContent,
  resolveContextFactTransition,
  selfContextFactCategories,
  selfContextFactCategorySchema,
  toContextFactView,
  updateSelfContextFactInputSchema,
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
    expect(selfContextFactCategories).toEqual([
      "background",
      "work",
      "location",
      "interest",
      "preference",
      "constraint",
      "other",
    ]);
    expect(selfContextFactCategorySchema.safeParse("composition").success).toBe(false);
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

  it("keeps Self updates limited to the editable fact fields", () => {
    expect(
      updateSelfContextFactInputSchema.safeParse({
        callerUserId: "user-1",
        contextFactId: "fact-1",
        category: "preference",
        content: "I prefer concise answers.",
        sensitivity: "sensitive",
      }).success,
    ).toBe(true);
    expect(
      updateSelfContextFactInputSchema.safeParse({
        callerUserId: "user-1",
        contextFactId: "fact-1",
        category: "composition",
        content: "This is not a self fact.",
        sensitivity: "normal",
      }).success,
    ).toBe(false);
    expect(
      updateSelfContextFactInputSchema.safeParse({
        callerUserId: "user-1",
        contextFactId: "fact-1",
        category: "work",
        content: "I run a consultancy.",
        sensitivity: "normal",
        subject: { kind: "self", userId: "user-1" },
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

  it("normalizes exact retries and distinguishes likely current-value conflicts", () => {
    expect(normalizeContextFactContent("  I WORK at Acme! ")).toBe("i work at acme");
    const subject = { kind: "self" as const, userId: "user-1" };
    const existing = {
      subject,
      category: "work" as const,
      content: "I work at Acme.",
      sensitivity: "normal" as const,
    };
    expect(
      isDuplicateContextFact({
        candidate: { ...existing, content: "i work at acme" },
        existing,
      }),
    ).toBe(true);
    expect(
      isLikelyConflictingContextFact({
        candidate: { ...existing, content: "I work at Northstar." },
        existing,
      }),
    ).toBe(true);
    expect(
      isLikelyConflictingContextFact({
        candidate: {
          subject,
          category: "interest",
          content: "I like hiking.",
          sensitivity: "normal",
        },
        existing: {
          subject,
          category: "interest",
          content: "I like running.",
          sensitivity: "normal",
        },
      }),
    ).toBe(false);
    expect(
      isDuplicateContextFact({
        candidate: { ...existing, category: "preference" },
        existing,
      }),
    ).toBe(false);
    expect(
      isDuplicateContextFact({
        candidate: { ...existing, sensitivity: "sensitive" },
        existing,
      }),
    ).toBe(false);
    expect(
      isLikelyConflictingContextFact({
        candidate: { ...existing, sensitivity: "sensitive" },
        existing,
      }),
    ).toBe(true);
  });

  it("has explicit archive and restore transitions", () => {
    expect(resolveContextFactTransition("active", "archive")).toBe("archived");
    expect(resolveContextFactTransition("archived", "restore")).toBe("active");
    expect(() => resolveContextFactTransition("archived", "archive")).toThrow("Cannot archive");
  });

  it("omits raw actor, source, and suggestion evidence fields from product views", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    const parsed = contextFactSchema.parse({
      id: "fact-1",
      subject: { kind: "self", userId: "user-1" },
      category: "work",
      content: "I run a consultancy.",
      lifecycle: "active",
      sensitivity: "normal",
      provenance: { channel: "account", origin: "direct", sourceRecordId: "source-1" },
      suggestionEvidence: "private evidence",
      creatorUserId: "user-1",
      lastActorUserId: "user-2",
      reviewedAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const view = toContextFactView(parsed);
    expect(view).toMatchObject({
      subject: { kind: "self" },
      provenance: { channel: "account", origin: "direct" },
    });
    expect(view).not.toHaveProperty("creatorUserId");
    expect(view).not.toHaveProperty("lastActorUserId");
    expect(view.provenance).not.toHaveProperty("sourceRecordId");
    expect(view).not.toHaveProperty("suggestionEvidence");

    const householdView = toContextFactView(
      contextFactSchema.parse({
        ...parsed,
        id: "household-fact-1",
        subject: { kind: "household", householdId: "household-1" },
      }),
    );
    expect(householdView.subject).toEqual({ kind: "household", householdId: "household-1" });
  });
});
