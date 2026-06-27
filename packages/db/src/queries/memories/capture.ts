import { createMemorySchema } from "@tendnote/domain";
import { createSourceRecordCapture } from "../source-records/capture";
import type {
  ApprovedMemoryEmbeddingScheduler,
  CaptureExplicitMemoryInput,
  CaptureExplicitMemoryResult,
  MemoryCaptureStore,
  PersonMemoryContextInput,
  PersonMemoryContextResult,
} from "./types";

/**
 * Explicit memory capture: a direct "remember/save/note/keep track of" request
 * creates a source record for provenance and an approved memory that points back
 * to it (ADR 0021, ADR 0022). All writes go through the shared owner-scoped store
 * and emit audit log entries (ADR 0001, ADR 0014).
 */
export function createMemoryCapture(
  store: MemoryCaptureStore,
  options: { scheduleApprovedMemoryEmbedding?: ApprovedMemoryEmbeddingScheduler } = {},
) {
  const sourceRecordCapture = createSourceRecordCapture(store);

  return {
    async captureExplicitMemory(
      input: CaptureExplicitMemoryInput,
    ): Promise<CaptureExplicitMemoryResult> {
      const content = input.content.trim();

      if (!content) {
        throw new Error("Explicit memory content is required.");
      }

      const person = await store.getPerson({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
      });

      if (!person) {
        throw new Error("Person not found.");
      }

      // Phase 1A policy defaults; callers may override during review/edit flows.
      const sensitivity = input.sensitivity ?? "normal";
      const confidence = input.confidence ?? "medium";
      const importance = input.importance ?? 3;

      const { sourceRecord } = await sourceRecordCapture.captureSourceRecord({
        ownerUserId: input.ownerUserId,
        retainedContent: input.retainedContent?.trim() || content,
        sourceType: input.sourceType ?? "manual",
        confidence,
        sensitivity,
        metadataJson: {
          ...input.metadataJson,
          capturedVia: "explicit_memory",
        },
      });

      await store.linkSourceRecordPerson({
        sourceRecordId: sourceRecord.id,
        personId: person.id,
        role: "primary",
      });

      const memoryValues = createMemorySchema.parse({
        personId: person.id,
        ownerUserId: input.ownerUserId,
        sourceRecordId: sourceRecord.id,
        memoryType: input.memoryType ?? "context",
        content,
        status: "approved",
        importance,
        sensitivity,
        confidence,
        scope: "private",
        approvedAt: new Date(),
      });
      const memory = await store.createMemory(memoryValues);

      await options.scheduleApprovedMemoryEmbedding?.({
        ownerUserId: memory.ownerUserId,
        recordKind: "memory",
        recordId: memory.id,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "memory.capture_explicit",
        entityType: "memory",
        entityId: memory.id,
        metadataJson: {
          personId: person.id,
          sourceRecordId: sourceRecord.id,
          status: memory.status,
        },
      });

      return { memory, sourceRecord, person };
    },
    async listPersonMemoryContext(
      input: PersonMemoryContextInput,
    ): Promise<PersonMemoryContextResult> {
      const person = await store.getPerson(input);

      if (!person) {
        return { person: null, memories: [] };
      }

      // Only approved memories are durable, confirmed facts (ADR 0004).
      const memories = await store.listApprovedMemoriesForPerson(input);

      return { person, memories };
    },
  };
}
