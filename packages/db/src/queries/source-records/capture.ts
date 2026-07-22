import { createSourceRecordSchema } from "@tendnote/domain";
import type {
  CaptureSourceRecordInput,
  CaptureSourceRecordResult,
  GetSourceRecordReviewInput,
  SourceRecordCaptureStore,
  SourceRecordReviewResult,
} from "./types";

export function createSourceRecordCapture(store: SourceRecordCaptureStore) {
  return {
    async captureSourceRecord(input: CaptureSourceRecordInput): Promise<CaptureSourceRecordResult> {
      const sourceRecordValues = createSourceRecordSchema.parse({
        ownerUserId: input.ownerUserId,
        sourceType: input.sourceType ?? "manual",
        content: input.retainedContent,
        rawContent: null,
        retentionPolicy: "retain",
        status:
          input.status ?? (input.unresolvedMentions?.length ? "pending_resolution" : "active"),
        confidence: input.confidence ?? "medium",
        sensitivity: input.sensitivity ?? "normal",
        scope: "private",
        importance: 3,
        metadataJson: input.metadataJson ?? {},
      });

      const sourceRecord = await store.createSourceRecord(sourceRecordValues);
      for (const mention of input.unresolvedMentions ?? []) {
        await store.createUnresolvedMention({
          sourceRecordId: sourceRecord.id,
          mentionText: mention.mentionText,
          candidatePersonIds: mention.candidatePersonIds ?? [],
        });
      }
      await store.createAuditLogEntry({
        ownerUserId: sourceRecord.ownerUserId,
        action: "source_record.capture",
        entityType: "source_record",
        entityId: sourceRecord.id,
        metadataJson: {
          sourceType: sourceRecord.sourceType,
          componentType: "source_record_review",
        },
      });

      return {
        sourceRecord,
        component: {
          type: "source_record_review",
          sourceRecordId: sourceRecord.id,
        },
      };
    },
    async getSourceRecordReview(
      input: GetSourceRecordReviewInput,
    ): Promise<SourceRecordReviewResult | null> {
      const sourceRecord = await store.getSourceRecord(input);

      if (!sourceRecord) {
        return null;
      }

      return {
        sourceRecord,
        unresolvedMentions: await store.listUnresolvedMentions({
          sourceRecordId: sourceRecord.id,
          ownerUserId: input.ownerUserId,
        }),
        component: {
          type: "source_record_review",
          sourceRecordId: sourceRecord.id,
        },
      };
    },
  };
}
