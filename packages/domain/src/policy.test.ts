import { describe, expect, it } from "vitest";
import { followupStatusSchema } from "./followups";
import {
  canUseMemoryProactively,
  createMemorySchema,
  isDurableMemoryFact,
  memoryStatusSchema,
} from "./memories";
import { relationshipTypeSchema, requiresPersonDisambiguation } from "./people";
import { sensitivitySchema } from "./privacy";
import {
  canExtractFromSourceRecord,
  sourceRecordSchema,
  sourceRecordStatusSchema,
  unresolvedPersonMentionSchema,
} from "./source-records";

const now = new Date("2026-06-24T12:00:00.000Z");

describe("phase 1 policy contracts", () => {
  it("uses professional relationship language and restricted sensitivity", () => {
    expect(relationshipTypeSchema.options).toContain("professional");
    expect(relationshipTypeSchema.options).not.toContain("client");
    expect(sensitivitySchema.options).toEqual(["normal", "sensitive", "restricted"]);
  });

  it("requires source-record provenance for memory writes", () => {
    expect(() =>
      createMemorySchema.parse({
        personId: "person-1",
        ownerUserId: "user-1",
        content: "Maya prefers short texts.",
      }),
    ).toThrow();

    expect(
      createMemorySchema.parse({
        personId: "person-1",
        ownerUserId: "user-1",
        sourceRecordId: "source-record-1",
        content: "Maya prefers short texts.",
      }).sourceRecordId,
    ).toBe("source-record-1");
  });

  it("keeps pending, dismissed, archived, and restricted source records out of extraction", () => {
    expect(sourceRecordStatusSchema.options).toEqual([
      "pending_resolution",
      "active",
      "dismissed",
      "archived",
    ]);

    expect(
      canExtractFromSourceRecord({ status: "pending_resolution", sensitivity: "normal" }),
    ).toBe(false);
    expect(canExtractFromSourceRecord({ status: "dismissed", sensitivity: "normal" })).toBe(false);
    expect(canExtractFromSourceRecord({ status: "archived", sensitivity: "normal" })).toBe(false);
    expect(canExtractFromSourceRecord({ status: "active", sensitivity: "restricted" })).toBe(false);
    expect(
      canExtractFromSourceRecord(
        { status: "active", sensitivity: "restricted" },
        { directlyRequested: true },
      ),
    ).toBe(true);
  });

  it("tracks unresolved person mentions as reviewable source-record state", () => {
    const mention = unresolvedPersonMentionSchema.parse({
      id: "mention-1",
      sourceRecordId: "source-record-1",
      mentionText: "Maya",
      candidatePersonIds: ["person-1", "person-2"],
      createdAt: now,
    });

    expect(mention.status).toBe("unresolved");
    expect(mention.candidatePersonIds).toHaveLength(2);
  });

  it("requires duplicate-name disambiguation when search returns multiple candidates", () => {
    expect(requiresPersonDisambiguation([{ id: "person-1" }, { id: "person-2" }])).toBe(true);
    expect(requiresPersonDisambiguation([{ id: "person-1" }])).toBe(false);
  });

  it("does not treat suggested, dismissed, or archived memories as durable facts", () => {
    expect(memoryStatusSchema.options).toEqual(["suggested", "approved", "dismissed", "archived"]);
    expect(isDurableMemoryFact({ status: "suggested" })).toBe(false);
    expect(isDurableMemoryFact({ status: "dismissed" })).toBe(false);
    expect(isDurableMemoryFact({ status: "archived" })).toBe(false);
    expect(isDurableMemoryFact({ status: "approved" })).toBe(true);
  });

  it("excludes non-approved and restricted memories from proactive retrieval", () => {
    expect(canUseMemoryProactively({ status: "suggested", sensitivity: "normal" })).toBe(false);
    expect(canUseMemoryProactively({ status: "dismissed", sensitivity: "normal" })).toBe(false);
    expect(canUseMemoryProactively({ status: "archived", sensitivity: "normal" })).toBe(false);
    expect(canUseMemoryProactively({ status: "approved", sensitivity: "restricted" })).toBe(false);
    expect(
      canUseMemoryProactively(
        { status: "approved", sensitivity: "restricted" },
        { directlyRequested: true },
      ),
    ).toBe(true);
  });

  it("keeps source records as retained evidence with non-authoritative metadata", () => {
    const sourceRecord = sourceRecordSchema.parse({
      id: "source-record-1",
      ownerUserId: "user-1",
      content: "Logged lunch with Jordan.",
      metadataJson: { location: "cafe" },
      createdAt: now,
      updatedAt: now,
    });

    expect(sourceRecord.retentionPolicy).toBe("retain");
    expect(sourceRecord.metadataJson).toEqual({ location: "cafe" });
  });

  it("supports the decided follow-up lifecycle states", () => {
    expect(followupStatusSchema.options).toEqual([
      "suggested",
      "open",
      "snoozed",
      "completed",
      "dismissed",
      "archived",
    ]);
  });
});
