import { describe, expect, it } from "vitest";
import { createInMemorySourceRecordStore, createSourceRecordCapture } from "../source-records";

describe("source record capture", () => {
  it("captures retained relationship context and returns a persisted review component reference", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());

    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Had lunch with Mark. He may be switching jobs.",
    });

    expect(result.sourceRecord).toMatchObject({
      ownerUserId: "user-1",
      content: "Had lunch with Mark. He may be switching jobs.",
      sourceType: "manual",
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    expect(result.component).toEqual({
      type: "source_record_review",
      sourceRecordId: result.sourceRecord.id,
    });
  });

  it("reloads a source-record review component from persisted state", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());
    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Logged that Nina is training for a fall marathon.",
    });

    const review = await capture.getSourceRecordReview({
      ownerUserId: "user-1",
      sourceRecordId: result.component.sourceRecordId,
    });

    expect(review).toEqual({
      component: result.component,
      sourceRecord: result.sourceRecord,
    });
  });

  it("does not reload another owner's source record review", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());
    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Remember that Priya prefers morning coffee chats.",
    });

    await expect(
      capture.getSourceRecordReview({
        ownerUserId: "user-2",
        sourceRecordId: result.component.sourceRecordId,
      }),
    ).resolves.toBeNull();
  });

  it("writes an audit log entry for capture", async () => {
    const store = createInMemorySourceRecordStore();
    const capture = createSourceRecordCapture(store);

    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Logged that Theo is moving in September.",
    });

    await expect(store.listAuditLogEntries({ ownerUserId: "user-1" })).resolves.toEqual([
      expect.objectContaining({
        ownerUserId: "user-1",
        action: "source_record.capture",
        entityType: "source_record",
        entityId: result.sourceRecord.id,
        metadataJson: {
          sourceType: "manual",
          componentType: "source_record_review",
        },
      }),
    ]);
  });
});
