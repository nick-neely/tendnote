import { canUseMemoryProactively, createMemorySchema } from "@tendnote/domain";
import { createSourceRecordCapture } from "../source-records/capture";
import type {
  ApprovedMemoryEmbeddingScheduler,
  CaptureExplicitMemoryFromSourceInput,
  CaptureExplicitMemoryInput,
  CaptureExplicitMemoryResult,
  CaptureSuggestedMemoryFromSourceInput,
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

  async function persistApprovedMemory(input: {
    ownerUserId: string;
    personId: string;
    sourceRecordId: string;
    content: string;
    memoryType?: CaptureExplicitMemoryFromSourceInput["memoryType"];
    sensitivity: CaptureExplicitMemoryFromSourceInput["sensitivity"];
    confidence: CaptureExplicitMemoryFromSourceInput["confidence"];
    importance: number;
    scope: CaptureExplicitMemoryFromSourceInput["scope"];
    householdId: string | null;
  }) {
    const existing = (
      await store.listMemoriesForSourceRecord({
        sourceRecordId: input.sourceRecordId,
      })
    ).find(
      (memory) =>
        memory.ownerUserId === input.ownerUserId &&
        memory.personId === input.personId &&
        memory.content === input.content &&
        memory.status === "approved",
    );
    if (existing) return existing;
    const memory = await store.createMemory(
      createMemorySchema.parse({
        personId: input.personId,
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
        memoryType: input.memoryType ?? "context",
        content: input.content,
        status: "approved",
        importance: input.importance,
        sensitivity: input.sensitivity,
        confidence: input.confidence,
        scope: input.scope ?? "private",
        householdId: input.householdId,
        approvedAt: new Date(),
      }),
    );
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
        personId: input.personId,
        sourceRecordId: input.sourceRecordId,
        status: memory.status,
      },
    });
    return memory;
  }

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

      const memory = await persistApprovedMemory({
        ownerUserId: input.ownerUserId,
        personId: person.id,
        sourceRecordId: sourceRecord.id,
        content,
        memoryType: input.memoryType,
        sensitivity,
        confidence,
        importance,
        scope: "private",
        householdId: null,
      });

      return { memory, sourceRecord, person };
    },
    async captureExplicitMemoryFromSource(input: CaptureExplicitMemoryFromSourceInput) {
      const content = input.content.trim();
      if (!content) throw new Error("Explicit memory content is required.");
      const [person, sourceRecord] = await Promise.all([
        store.getPerson({ ownerUserId: input.ownerUserId, personId: input.personId }),
        store.getSourceRecord({
          ownerUserId: input.ownerUserId,
          sourceRecordId: input.sourceRecordId,
        }),
      ]);
      if (!person) throw new Error("Person not found.");
      if (!sourceRecord) throw new Error("Source record not found.");
      await store.linkSourceRecordPerson({
        sourceRecordId: sourceRecord.id,
        personId: person.id,
        role: "primary",
      });
      const memory = await persistApprovedMemory({
        ownerUserId: input.ownerUserId,
        personId: person.id,
        sourceRecordId: sourceRecord.id,
        content,
        memoryType: input.memoryType,
        sensitivity: input.sensitivity ?? sourceRecord.sensitivity,
        confidence: input.confidence ?? "medium",
        importance: input.importance ?? 3,
        scope: input.scope ?? "private",
        householdId: input.householdId ?? null,
      });
      return { memory, sourceRecord, person };
    },
    async captureSuggestedMemoryFromSource(input: CaptureSuggestedMemoryFromSourceInput) {
      const content = input.content.trim();
      if (!content) throw new Error("Suggested memory content is required.");
      const [person, sourceRecord, existingMemories] = await Promise.all([
        store.getPerson({ ownerUserId: input.ownerUserId, personId: input.personId }),
        store.getSourceRecord({
          ownerUserId: input.ownerUserId,
          sourceRecordId: input.sourceRecordId,
        }),
        store.listMemoriesForSourceRecord({ sourceRecordId: input.sourceRecordId }),
      ]);
      if (!person) throw new Error("Person not found.");
      if (!sourceRecord) throw new Error("Source record not found.");
      const existing = existingMemories.find(
        (memory) =>
          memory.ownerUserId === input.ownerUserId &&
          memory.personId === input.personId &&
          memory.content === content &&
          memory.status === "suggested",
      );
      if (existing) return { memory: existing, sourceRecord, person };
      await store.linkSourceRecordPerson({
        sourceRecordId: sourceRecord.id,
        personId: person.id,
        role: "primary",
      });
      const memory = await store.createMemory(
        createMemorySchema.parse({
          personId: person.id,
          ownerUserId: input.ownerUserId,
          sourceRecordId: sourceRecord.id,
          memoryType: "context",
          content,
          status: "suggested",
          importance: 3,
          sensitivity: sourceRecord.sensitivity,
          confidence: "medium",
          scope: "private",
          householdId: null,
          approvedAt: null,
        }),
      );
      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "memory.capture_inferred_suggestion",
        entityType: "memory",
        entityId: memory.id,
        metadataJson: {
          authority: "inferred",
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
        return { person: null, memories: [], restrictedMemories: [] };
      }

      // Only approved memories are durable, confirmed facts (ADR 0004).
      const approved = await store.listApprovedMemoriesForPerson(input);

      // The split is the proactive-use policy itself, applied once here instead
      // of by each caller. Reading it back out of the same list is what keeps
      // the two halves exhaustive: a memory the policy declines is restricted,
      // and it stays reachable to the owner rather than silently disappearing
      // the way a caller-side filter used to drop it.
      return {
        person,
        memories: approved.filter((memory) => canUseMemoryProactively(memory)),
        restrictedMemories: approved.filter((memory) => !canUseMemoryProactively(memory)),
      };
    },
  };
}
