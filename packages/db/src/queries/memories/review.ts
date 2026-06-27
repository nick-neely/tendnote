import { applyMemoryReviewEdit, memoryReviewEditSchema } from "@tendnote/domain";
import type {
  ApprovedMemoryEmbeddingScheduler,
  EditSuggestedMemoryInput,
  ListSuggestedMemoryReviewsInput,
  MemoryReviewActionInput,
  MemoryReviewStore,
  SaveSuggestedMemoryInput,
  SuggestedMemoryReviewResult,
} from "./types";

/**
 * Suggested-memory review loop (ADR 0002, ADR 0025): the core Phase 1A
 * trust-building surface. Review components reference persisted memory and
 * source-record ids (ADR 0028) so Save/Edit/Dismiss/Archive always operate on
 * authoritative records, never ephemeral model output. Every mutation flows
 * through the shared owner-scoped store and writes an audit entry (ADR 0001,
 * ADR 0014, ADR 0053).
 */
export function createMemoryReview(
  store: MemoryReviewStore,
  options: { scheduleApprovedMemoryEmbedding?: ApprovedMemoryEmbeddingScheduler } = {},
) {
  async function buildReviewResult(
    ownerUserId: string,
    memory: Awaited<ReturnType<MemoryReviewStore["getMemory"]>>,
  ): Promise<SuggestedMemoryReviewResult | null> {
    if (!memory) {
      return null;
    }

    // Source context grounds the review: the user sees where the suggestion came
    // from (ADR 0005). Owner-scoped, so a record from another owner never leaks.
    // The person is resolved alongside it so every review surface can name whom
    // the suggestion is about rather than leaking a raw id (ADR 0028).
    const [sourceRecord, person] = await Promise.all([
      store.getSourceRecord({ ownerUserId, sourceRecordId: memory.sourceRecordId }),
      store.getPerson({ ownerUserId, personId: memory.personId }),
    ]);

    return {
      memory,
      sourceRecord,
      person,
      component: {
        type: "suggested_memory_review",
        memoryId: memory.id,
        sourceRecordId: memory.sourceRecordId,
      },
    };
  }

  async function requireSuggestedMemory(input: MemoryReviewActionInput) {
    const memory = await store.getMemory(input);

    if (!memory) {
      throw new Error("Memory not found.");
    }

    if (memory.status !== "suggested") {
      throw new Error("Only suggested memories can be reviewed.");
    }

    return memory;
  }

  return {
    async listSuggestedMemoryReviews(
      input: ListSuggestedMemoryReviewsInput,
    ): Promise<SuggestedMemoryReviewResult[]> {
      const suggested = await store.listSuggestedMemoriesForOwner(input);
      const results = await Promise.all(
        suggested.map((memory) => buildReviewResult(input.ownerUserId, memory)),
      );

      return results.filter((result): result is SuggestedMemoryReviewResult => result !== null);
    },

    async getSuggestedMemoryReview(
      input: MemoryReviewActionInput,
    ): Promise<SuggestedMemoryReviewResult | null> {
      const memory = await store.getMemory(input);

      if (memory?.status !== "suggested") {
        return null;
      }

      return buildReviewResult(input.ownerUserId, memory);
    },

    /** Promote a suggested memory to approved durable context, applying any edit. */
    async saveSuggestedMemory(
      input: SaveSuggestedMemoryInput,
    ): Promise<SuggestedMemoryReviewResult> {
      const memory = await requireSuggestedMemory(input);
      const edit = memoryReviewEditSchema.parse(input.edit ?? {});
      const edited = applyMemoryReviewEdit(memory, edit);

      const updated = await store.updateMemory({
        ownerUserId: input.ownerUserId,
        memoryId: memory.id,
        patch: {
          content: edited.content,
          memoryType: edited.memoryType,
          sensitivity: edited.sensitivity,
          importance: edited.importance,
          status: "approved",
          approvedAt: new Date(),
        },
      });

      await options.scheduleApprovedMemoryEmbedding?.({
        ownerUserId: updated.ownerUserId,
        recordKind: "memory",
        recordId: updated.id,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "memory.review_save",
        entityType: "memory",
        entityId: updated.id,
        metadataJson: {
          sourceRecordId: updated.sourceRecordId,
          personId: updated.personId,
          sensitivity: updated.sensitivity,
          edited: Object.keys(edit).length > 0,
        },
      });

      const result = await buildReviewResult(input.ownerUserId, updated);

      if (!result) {
        throw new Error("Saved memory could not be reloaded.");
      }

      return result;
    },

    /** Correct a suggested memory in place without approving it yet. */
    async editSuggestedMemory(
      input: EditSuggestedMemoryInput,
    ): Promise<SuggestedMemoryReviewResult> {
      const memory = await requireSuggestedMemory(input);
      const edit = memoryReviewEditSchema.parse(input.edit);
      const edited = applyMemoryReviewEdit(memory, edit);

      const updated = await store.updateMemory({
        ownerUserId: input.ownerUserId,
        memoryId: memory.id,
        patch: {
          content: edited.content,
          memoryType: edited.memoryType,
          sensitivity: edited.sensitivity,
          importance: edited.importance,
        },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "memory.review_edit",
        entityType: "memory",
        entityId: updated.id,
        metadataJson: {
          sourceRecordId: updated.sourceRecordId,
          personId: updated.personId,
          sensitivity: updated.sensitivity,
        },
      });

      const result = await buildReviewResult(input.ownerUserId, updated);

      if (!result) {
        throw new Error("Edited memory could not be reloaded.");
      }

      return result;
    },

    /** Reject a suggestion so it is excluded from retrieval and not reintroduced. */
    async dismissSuggestedMemory(input: MemoryReviewActionInput) {
      const memory = await requireSuggestedMemory(input);

      const updated = await store.updateMemory({
        ownerUserId: input.ownerUserId,
        memoryId: memory.id,
        patch: { status: "dismissed", dismissedAt: new Date() },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "memory.review_dismiss",
        entityType: "memory",
        entityId: updated.id,
        metadataJson: { sourceRecordId: updated.sourceRecordId, personId: updated.personId },
      });

      return updated;
    },

    /**
     * Archive a memory out of normal views while keeping product history. Allowed
     * from suggested or approved; archiving is not a hard delete (ADR 0024).
     */
    async archiveMemory(input: MemoryReviewActionInput) {
      const memory = await store.getMemory(input);

      if (!memory) {
        throw new Error("Memory not found.");
      }

      if (memory.status === "archived") {
        return memory;
      }

      const updated = await store.updateMemory({
        ownerUserId: input.ownerUserId,
        memoryId: memory.id,
        patch: { status: "archived" },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "memory.review_archive",
        entityType: "memory",
        entityId: updated.id,
        metadataJson: {
          sourceRecordId: updated.sourceRecordId,
          previousStatus: memory.status,
        },
      });

      return updated;
    },
  };
}
