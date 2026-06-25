import { describe, expect, it } from "vitest";
import {
  createExtractionJobSchema,
  decideExtraction,
  extractionJobSchema,
} from "./extraction-jobs";

describe("extraction job schema", () => {
  it("requires an idempotency key and a source record", () => {
    expect(() =>
      createExtractionJobSchema.parse({
        sourceRecordId: "source-1",
        idempotencyKey: "source_record:source-1",
        runAfter: new Date(),
      }),
    ).not.toThrow();

    expect(() =>
      createExtractionJobSchema.parse({
        sourceRecordId: "source-1",
        idempotencyKey: "",
        runAfter: new Date(),
      }),
    ).toThrow();
  });

  it("defaults a new job to pending with zero attempts", () => {
    const parsed = createExtractionJobSchema.parse({
      sourceRecordId: "source-1",
      idempotencyKey: "source_record:source-1",
      runAfter: new Date(),
    });

    expect(parsed.status).toBe("pending");
    expect(parsed.attempts).toBe(0);
  });

  it("round-trips a persisted job shape", () => {
    const now = new Date();
    expect(() =>
      extractionJobSchema.parse({
        id: "job-1",
        sourceRecordId: "source-1",
        status: "completed",
        attempts: 1,
        lastError: null,
        idempotencyKey: "source_record:source-1",
        runAfter: now,
        claimedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).not.toThrow();
  });
});

describe("decideExtraction policy", () => {
  it("skips records that are not active", () => {
    expect(
      decideExtraction({
        sourceRecord: { status: "pending_resolution", sensitivity: "normal" },
        resolvedPersonCount: 0,
        unresolvedMentionCount: 0,
      }),
    ).toEqual({ action: "skip", reason: "source_record_not_active" });
  });

  it("skips restricted content from proactive extraction unless directly requested", () => {
    expect(
      decideExtraction({
        sourceRecord: { status: "active", sensitivity: "restricted" },
        resolvedPersonCount: 1,
        unresolvedMentionCount: 0,
      }),
    ).toEqual({ action: "skip", reason: "restricted_content" });

    expect(
      decideExtraction({
        sourceRecord: { status: "active", sensitivity: "restricted" },
        resolvedPersonCount: 1,
        unresolvedMentionCount: 0,
        directlyRequested: true,
      }),
    ).toEqual({ action: "extract" });
  });

  it("delays an active personless record that still has unresolved mentions", () => {
    expect(
      decideExtraction({
        sourceRecord: { status: "active", sensitivity: "normal" },
        resolvedPersonCount: 0,
        unresolvedMentionCount: 2,
      }),
    ).toEqual({ action: "delay", reason: "awaiting_mention_resolution" });
  });

  it("skips an active record that has no linked people and nothing left to resolve", () => {
    expect(
      decideExtraction({
        sourceRecord: { status: "active", sensitivity: "normal" },
        resolvedPersonCount: 0,
        unresolvedMentionCount: 0,
      }),
    ).toEqual({ action: "skip", reason: "no_linked_people" });
  });

  it("extracts when at least one person is resolved", () => {
    expect(
      decideExtraction({
        sourceRecord: { status: "active", sensitivity: "sensitive" },
        resolvedPersonCount: 1,
        unresolvedMentionCount: 1,
      }),
    ).toEqual({ action: "extract" });
  });
});
