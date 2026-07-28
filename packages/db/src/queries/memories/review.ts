import {
  applyMemoryReviewEdit,
  memoryReviewEditSchema,
  SOURCE_RECORD_AUTO_APPROVE_KEY,
} from "@tendnote/domain";
import type {
  ApprovedMemoryEmbeddingScheduler,
  ApproveExtractedMemoriesResult,
  DismissExtractedMemoriesResult,
  EditSuggestedMemoryInput,
  ListSuggestedMemoryReviewsInput,
  MemoryReviewActionInput,
  MemoryReviewStore,
  SaveSuggestedMemoryInput,
  SourceRecordMemoryActionInput,
  SuggestedMemoryReviewResult,
} from "./types";

/**
 * What the review actions need from their environment: the owner-scoped store and
 * the optional approved-memory embedding scheduler. Bundling it lets each action
 * live at module scope as a focused, directly testable function rather than a
 * closure nested in the factory.
 */
type MemoryReviewContext = {
  store: MemoryReviewStore;
  scheduleApprovedMemoryEmbedding?: ApprovedMemoryEmbeddingScheduler;
};

/**
 * Assembles a review result around a memory: its source record and person are
 * resolved owner-scoped (so nothing leaks across owners) and named, so every
 * review surface can say where the suggestion came from and whom it is about
 * (ADR 0005, ADR 0028). Returns null when the memory itself is absent.
 */
async function buildReviewResult(
  ctx: MemoryReviewContext,
  ownerUserId: string,
  memory: Awaited<ReturnType<MemoryReviewStore["getMemory"]>>,
): Promise<SuggestedMemoryReviewResult | null> {
  if (!memory) {
    return null;
  }

  const [sourceRecord, person] = await Promise.all([
    ctx.store.getSourceRecord({ ownerUserId, sourceRecordId: memory.sourceRecordId }),
    ctx.store.getPerson({ ownerUserId, personId: memory.personId }),
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

/** Loads a memory and asserts it is still an actionable suggestion. */
async function requireSuggestedMemory(ctx: MemoryReviewContext, input: MemoryReviewActionInput) {
  const memory = await ctx.store.getMemory(input);

  if (!memory) {
    throw new Error("Memory not found.");
  }

  if (memory.status !== "suggested") {
    throw new Error("Only suggested memories can be reviewed.");
  }

  return memory;
}

async function listSuggestedMemoryReviews(
  ctx: MemoryReviewContext,
  input: ListSuggestedMemoryReviewsInput,
): Promise<SuggestedMemoryReviewResult[]> {
  const suggested = await ctx.store.listSuggestedMemoriesForOwner(input);
  const results = await Promise.all(
    suggested.map((memory) => buildReviewResult(ctx, input.ownerUserId, memory)),
  );

  return results.filter((result): result is SuggestedMemoryReviewResult => result !== null);
}

async function getSuggestedMemoryReview(
  ctx: MemoryReviewContext,
  input: MemoryReviewActionInput,
): Promise<SuggestedMemoryReviewResult | null> {
  const memory = await ctx.store.getMemory(input);

  if (memory?.status !== "suggested") {
    return null;
  }

  return buildReviewResult(ctx, input.ownerUserId, memory);
}

/** Promote a suggested memory to approved durable context, applying any edit. */
async function saveSuggestedMemory(
  ctx: MemoryReviewContext,
  input: SaveSuggestedMemoryInput,
): Promise<SuggestedMemoryReviewResult> {
  const { store } = ctx;
  const memory = await requireSuggestedMemory(ctx, input);
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

  await ctx.scheduleApprovedMemoryEmbedding?.({
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

  const result = await buildReviewResult(ctx, input.ownerUserId, updated);

  if (!result) {
    throw new Error("Saved memory could not be reloaded.");
  }

  return result;
}

/** Correct a suggested memory in place without approving it yet. */
async function editSuggestedMemory(
  ctx: MemoryReviewContext,
  input: EditSuggestedMemoryInput,
): Promise<SuggestedMemoryReviewResult> {
  const { store } = ctx;
  const memory = await requireSuggestedMemory(ctx, input);
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

  const result = await buildReviewResult(ctx, input.ownerUserId, updated);

  if (!result) {
    throw new Error("Edited memory could not be reloaded.");
  }

  return result;
}

/** Reject a suggestion so it is excluded from retrieval and not reintroduced. */
async function dismissSuggestedMemory(ctx: MemoryReviewContext, input: MemoryReviewActionInput) {
  const { store } = ctx;
  const memory = await requireSuggestedMemory(ctx, input);

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
}

/** Restores only the suggestion most recently dismissed through this review surface. */
async function restoreDismissedSuggestedMemory(
  ctx: MemoryReviewContext,
  input: MemoryReviewActionInput,
) {
  const { store } = ctx;
  const memory = await store.getMemory(input);
  if (memory?.status !== "dismissed") {
    throw new Error("Only dismissed suggested memories can be restored to review.");
  }
  const audit = await store.listAuditLogEntries({ ownerUserId: input.ownerUserId });
  const dismissal = audit
    .filter((entry) => entry.entityType === "memory" && entry.entityId === memory.id)
    .at(-1);
  if (dismissal?.action !== "memory.review_dismiss") {
    throw new Error("Only dismissed suggested memories can be restored to review.");
  }
  const updated = await store.updateMemory({
    ownerUserId: input.ownerUserId,
    memoryId: memory.id,
    patch: { status: "suggested", dismissedAt: null },
  });
  await store.createAuditLogEntry({
    ownerUserId: input.ownerUserId,
    action: "memory.review_restore",
    entityType: "memory",
    entityId: updated.id,
    metadataJson: {
      personId: updated.personId,
      sourceRecordId: updated.sourceRecordId,
      previousStatus: memory.status,
    },
  });
  const result = await buildReviewResult(ctx, input.ownerUserId, updated);
  if (!result) throw new Error("Restored memory could not be reloaded.");
  return result;
}

/**
 * Approve a logged note inline — the "approve" action on the in-chat logged-note
 * card. This rides the automatic extraction pipeline rather than replacing it: it
 * (1) pre-approves the note so any memories the extractor *later* distills from it
 * are saved as confirmed facts instead of tentative suggestions, and (2) approves
 * any suggestions the extractor *already* produced (the inline/dev case, where
 * extraction runs during capture). Each approval uses the same promote-to-approved
 * path as single-memory review, so embeddings and audit stay consistent.
 */
async function approveExtractedMemoriesForSourceRecord(
  ctx: MemoryReviewContext,
  input: SourceRecordMemoryActionInput,
): Promise<ApproveExtractedMemoriesResult> {
  const { store } = ctx;
  const sourceRecord = await store.getSourceRecord({
    ownerUserId: input.ownerUserId,
    sourceRecordId: input.sourceRecordId,
  });

  if (!sourceRecord) {
    throw new Error("Source record not found.");
  }

  await store.updateSourceRecordMetadata({
    ownerUserId: input.ownerUserId,
    sourceRecordId: input.sourceRecordId,
    metadataJson: { ...sourceRecord.metadataJson, [SOURCE_RECORD_AUTO_APPROVE_KEY]: true },
  });

  const memories = await store.listMemoriesForSourceRecord({
    sourceRecordId: input.sourceRecordId,
  });
  const approvedMemoryIds: string[] = [];

  for (const memory of memories) {
    if (memory.status !== "suggested") {
      continue;
    }

    const updated = await store.updateMemory({
      ownerUserId: input.ownerUserId,
      memoryId: memory.id,
      patch: { status: "approved", approvedAt: new Date() },
    });

    await ctx.scheduleApprovedMemoryEmbedding?.({
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
        sourceRecordId: input.sourceRecordId,
        personId: updated.personId,
        autoApproved: true,
      },
    });

    approvedMemoryIds.push(updated.id);
  }

  await store.createAuditLogEntry({
    ownerUserId: input.ownerUserId,
    action: "source_record.auto_approve_memories",
    entityType: "source_record",
    entityId: sourceRecord.id,
    metadataJson: { approvedMemoryCount: approvedMemoryIds.length },
  });

  return { sourceRecordId: input.sourceRecordId, autoApprove: true, approvedMemoryIds };
}

/**
 * Dismiss a logged note inline — the "dismiss" action on the in-chat logged-note
 * card. Mirrors approve: it dismisses the note (which, being non-active, stops the
 * extractor from producing anything further from it) and dismisses any suggestions
 * already extracted, so a dismissed note never resurfaces in review.
 */
async function dismissExtractedMemoriesForSourceRecord(
  ctx: MemoryReviewContext,
  input: SourceRecordMemoryActionInput,
): Promise<DismissExtractedMemoriesResult> {
  const { store } = ctx;
  const sourceRecord = await store.getSourceRecord({
    ownerUserId: input.ownerUserId,
    sourceRecordId: input.sourceRecordId,
  });

  if (!sourceRecord) {
    throw new Error("Source record not found.");
  }

  const updatedRecord = await store.updateSourceRecordStatus({
    ownerUserId: input.ownerUserId,
    sourceRecordId: input.sourceRecordId,
    status: "dismissed",
  });

  const memories = await store.listMemoriesForSourceRecord({
    sourceRecordId: input.sourceRecordId,
  });
  const dismissedMemoryIds: string[] = [];

  for (const memory of memories) {
    if (memory.status !== "suggested") {
      continue;
    }

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
      metadataJson: { sourceRecordId: input.sourceRecordId, personId: updated.personId },
    });

    dismissedMemoryIds.push(updated.id);
  }

  await store.createAuditLogEntry({
    ownerUserId: input.ownerUserId,
    action: "source_record.dismiss",
    entityType: "source_record",
    entityId: updatedRecord.id,
    metadataJson: { dismissedMemoryCount: dismissedMemoryIds.length },
  });

  return {
    sourceRecordId: input.sourceRecordId,
    status: updatedRecord.status,
    dismissedMemoryIds,
  };
}

/**
 * Archive a memory out of normal views while keeping product history. Allowed
 * from suggested or approved; archiving is not a hard delete (ADR 0024).
 */
async function archiveMemory(ctx: MemoryReviewContext, input: MemoryReviewActionInput) {
  const { store } = ctx;
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
}

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
  const ctx: MemoryReviewContext = {
    store,
    scheduleApprovedMemoryEmbedding: options.scheduleApprovedMemoryEmbedding,
  };

  return {
    listSuggestedMemoryReviews: (input: ListSuggestedMemoryReviewsInput) =>
      listSuggestedMemoryReviews(ctx, input),
    getSuggestedMemoryReview: (input: MemoryReviewActionInput) =>
      getSuggestedMemoryReview(ctx, input),
    saveSuggestedMemory: (input: SaveSuggestedMemoryInput) => saveSuggestedMemory(ctx, input),
    editSuggestedMemory: (input: EditSuggestedMemoryInput) => editSuggestedMemory(ctx, input),
    dismissSuggestedMemory: (input: MemoryReviewActionInput) => dismissSuggestedMemory(ctx, input),
    restoreDismissedSuggestedMemory: (input: MemoryReviewActionInput) =>
      restoreDismissedSuggestedMemory(ctx, input),
    approveExtractedMemoriesForSourceRecord: (input: SourceRecordMemoryActionInput) =>
      approveExtractedMemoriesForSourceRecord(ctx, input),
    dismissExtractedMemoriesForSourceRecord: (input: SourceRecordMemoryActionInput) =>
      dismissExtractedMemoriesForSourceRecord(ctx, input),
    archiveMemory: (input: MemoryReviewActionInput) => archiveMemory(ctx, input),
  };
}
