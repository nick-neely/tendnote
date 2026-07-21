import { createHash } from "node:crypto";
import {
  type Asset,
  type AssetMemory,
  createRelationshipContextEmbeddingSchema,
  decideApprovedMemoryEmbedding,
  decideAssetEmbedding,
  decideAssetMemoryEmbedding,
  decideGeneralActionEmbedding,
  decideSavedItemEmbedding,
  decideSourceRecordEmbedding,
  type GeneralAction,
  type Memory,
  projectApprovedMemoryEmbeddedText,
  projectAssetEmbeddedText,
  projectAssetMemoryEmbeddedText,
  projectGeneralActionEmbeddedText,
  projectSavedItemEmbeddedText,
  projectSourceRecordEmbeddedText,
  type SavedItem,
  type SemanticRecordKind,
  type SemanticTrustLevel,
  type SourceRecord,
} from "@tendnote/domain";
import type {
  EmbeddingAdapter,
  EmbeddingConfig,
  EmbeddingStore,
  ProcessEmbeddingJobResult,
} from "./types";

/**
 * What the embedding steps need from their environment: the owner-scoped store,
 * the embedding adapter, and the active model/version config. Bundling it lets
 * each step live at module scope as a focused, directly testable function rather
 * than a closure nested in the factory.
 */
export type EmbeddingContext = {
  store: EmbeddingStore;
  adapter: EmbeddingAdapter;
  config: EmbeddingConfig;
};

/** A successfully produced or reused embedding plus the record it came from. */
export type EmbeddingProduced = Omit<ProcessEmbeddingJobResult, "job" | "outcome">;

type RelationshipContextEmbedding = Awaited<
  ReturnType<EmbeddingStore["upsertRelationshipContextEmbedding"]>
>;

/** Content-addressed fingerprint of the embedded text, so unchanged text is detectable. */
export function fingerprintEmbeddedText(input: {
  recordKind: SemanticRecordKind;
  recordId: string;
  embeddedText: string;
}) {
  return createHash("sha256")
    .update(input.recordKind)
    .update("\0")
    .update(input.recordId)
    .update("\0")
    .update(input.embeddedText)
    .digest("hex");
}

/**
 * Returns the existing embedding when its content fingerprint still matches (so
 * unchanged text never re-embeds), otherwise calls the adapter and upserts a
 * fresh one. The fingerprint/find/embed/upsert flow is identical for memories
 * and source records, so both record kinds route through here with only the
 * record-specific fields differing.
 */
async function reuseOrEmbed(
  ctx: EmbeddingContext,
  params: {
    ownerUserId: string;
    recordKind: SemanticRecordKind;
    recordId: string;
    embeddedText: string;
    personId: string | null;
    trustLevel: SemanticTrustLevel;
    sensitivity: SourceRecord["sensitivity"];
    sourceUpdatedAt: Date;
  },
): Promise<RelationshipContextEmbedding> {
  const { store, adapter, config } = ctx;
  const contentFingerprint = fingerprintEmbeddedText({
    recordKind: params.recordKind,
    recordId: params.recordId,
    embeddedText: params.embeddedText,
  });

  const existing = await store.findRelationshipContextEmbedding({
    ownerUserId: params.ownerUserId,
    recordKind: params.recordKind,
    recordId: params.recordId,
    embeddingModel: config.model,
    embeddingVersion: config.version,
  });

  if (existing?.contentFingerprint === contentFingerprint) {
    return existing;
  }

  const adapterResult = await adapter.embedText({
    text: params.embeddedText,
    model: config.model,
    version: config.version,
  });

  return store.upsertRelationshipContextEmbedding(
    createRelationshipContextEmbeddingSchema.parse({
      ownerUserId: params.ownerUserId,
      personId: params.personId,
      recordKind: params.recordKind,
      recordId: params.recordId,
      embedding: adapterResult.vector,
      embeddingModel: adapterResult.model,
      embeddingVersion: adapterResult.version,
      embeddingDimensions: adapterResult.vector.length,
      embeddedText: params.embeddedText,
      contentFingerprint,
      trustLevel: params.trustLevel,
      sensitivity: params.sensitivity,
      sourceUpdatedAt: params.sourceUpdatedAt,
    }),
  );
}

/** Fail the job and requeue it on a backoff so a transient error retries. */
export async function failJob(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
  message: string,
  now: Date,
  retryDelayMs: number,
): Promise<ProcessEmbeddingJobResult> {
  const updated = await ctx.store.updateEmbeddingJob({
    jobId: job.id,
    status: "failed",
    lastError: message,
    runAfter: new Date(now.getTime() + retryDelayMs),
    claimedAt: null,
  });

  await ctx.store.createAuditLogEntry({
    ownerUserId: job.ownerUserId,
    action: "embedding_job.failed",
    entityType: "relationship_context_embedding_job",
    entityId: job.id,
    metadataJson: {
      recordKind: job.recordKind,
      recordId: job.recordId,
      error: message,
    },
  });

  return { job: updated, outcome: "failed", embedding: null, error: message };
}

/** Terminal "skip" outcome: this record is not eligible for embedding. */
export async function skipJob(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
  reason: string,
  now: Date,
  sources: {
    sourceMemory?: Memory | null;
    sourceRecord?: SourceRecord | null;
    sourceGeneralAction?: GeneralAction | null;
    sourceAsset?: Asset | null;
    sourceAssetMemory?: AssetMemory | null;
    sourceSavedItem?: SavedItem | null;
  } = {},
): Promise<ProcessEmbeddingJobResult> {
  const updated = await ctx.store.updateEmbeddingJob({
    jobId: job.id,
    status: "skipped",
    completedAt: now,
  });

  await ctx.store.createAuditLogEntry({
    ownerUserId: job.ownerUserId,
    action: "embedding_job.skipped",
    entityType: "relationship_context_embedding_job",
    entityId: job.id,
    metadataJson: {
      recordKind: job.recordKind,
      recordId: job.recordId,
      reason,
    },
  });

  return {
    job: updated,
    outcome: "skipped",
    embedding: null,
    sourceMemory: sources.sourceMemory ?? null,
    sourceRecord: sources.sourceRecord ?? null,
    sourceGeneralAction: sources.sourceGeneralAction ?? null,
    sourceAsset: sources.sourceAsset ?? null,
    sourceAssetMemory: sources.sourceAssetMemory ?? null,
    sourceSavedItem: sources.sourceSavedItem ?? null,
    reason,
  };
}

/**
 * Embeds an approved memory. Skips when the memory is gone or ineligible, reuses
 * an existing embedding whose content fingerprint still matches (so unchanged
 * text never re-embeds), and otherwise calls the adapter and upserts the result.
 */
export async function processApprovedMemory(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
): Promise<EmbeddingProduced | { skipReason: string; sourceMemory: Memory | null }> {
  const memory = await ctx.store.getMemory({
    ownerUserId: job.ownerUserId,
    memoryId: job.recordId,
  });

  if (!memory) {
    return { skipReason: "memory_not_found", sourceMemory: null };
  }

  const decision = decideApprovedMemoryEmbedding(memory);

  if (decision.action === "skip") {
    return { skipReason: decision.reason, sourceMemory: memory };
  }

  const embedding = await reuseOrEmbed(ctx, {
    ownerUserId: memory.ownerUserId,
    recordKind: "memory",
    recordId: memory.id,
    embeddedText: projectApprovedMemoryEmbeddedText(memory),
    personId: memory.personId,
    trustLevel: "confirmed_fact",
    sensitivity: memory.sensitivity,
    sourceUpdatedAt: memory.updatedAt,
  });

  return { embedding, sourceMemory: memory };
}

/**
 * Embeds a source record, resolving its linked people to build the embedded text
 * and to set the primary person. Mirrors {@link processApprovedMemory}: skip when
 * missing or ineligible, reuse a fingerprint-matching embedding, else embed and
 * upsert.
 */
export async function processSourceRecord(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
): Promise<EmbeddingProduced | { skipReason: string; sourceRecord: SourceRecord | null }> {
  const { store } = ctx;
  const sourceRecord = await store.getSourceRecord({
    ownerUserId: job.ownerUserId,
    sourceRecordId: job.recordId,
  });

  if (!sourceRecord) {
    return { skipReason: "source_record_not_found", sourceRecord: null };
  }

  const [links, unresolvedMentions] = await Promise.all([
    store.listSourceRecordPeople({
      ownerUserId: sourceRecord.ownerUserId,
      sourceRecordId: sourceRecord.id,
    }),
    store.listUnresolvedMentions({
      ownerUserId: sourceRecord.ownerUserId,
      sourceRecordId: sourceRecord.id,
    }),
  ]);
  const people = (
    await Promise.all(
      links.map((link) =>
        store.getPerson({ ownerUserId: sourceRecord.ownerUserId, personId: link.personId }),
      ),
    )
  )
    .filter((person): person is NonNullable<typeof person> => Boolean(person))
    .map((person) => ({ id: person.id, displayName: person.displayName }));
  const unresolvedMentionCount = unresolvedMentions.filter(
    (mention) => mention.status === "unresolved",
  ).length;
  const decision = decideSourceRecordEmbedding(sourceRecord, people, unresolvedMentionCount);

  if (decision.action === "skip") {
    return { skipReason: decision.reason, sourceRecord };
  }

  const primaryPerson = people[0] ?? null;
  const embedding = await reuseOrEmbed(ctx, {
    ownerUserId: sourceRecord.ownerUserId,
    recordKind: "source_record",
    recordId: sourceRecord.id,
    embeddedText: projectSourceRecordEmbeddedText(sourceRecord, people),
    personId: primaryPerson?.id ?? null,
    trustLevel: "logged_context",
    sensitivity: sourceRecord.sensitivity,
    sourceUpdatedAt: sourceRecord.updatedAt,
  });

  return { embedding, sourceRecord };
}

/**
 * Embeds a General Action. Mirrors {@link processApprovedMemory}: skip when the action
 * is gone or no longer retrievable (terminal, `ignored`, or emptied), reuse a
 * fingerprint-matching embedding, else embed and upsert. A General Action is not
 * person-centered context (ADRs 0143, 0155), so its embedding carries no primary
 * person; scope and the owner-only rule for `suggested` proposals are enforced at the
 * search seam, not here. It is embedded with `action_item` trust and `normal`
 * sensitivity (General Actions carry no sensitivity flag).
 */
export async function processGeneralAction(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
): Promise<EmbeddingProduced | { skipReason: string; sourceGeneralAction: GeneralAction | null }> {
  const action = await ctx.store.getGeneralActionForEmbedding({
    ownerUserId: job.ownerUserId,
    generalActionId: job.recordId,
  });

  if (!action) {
    return { skipReason: "general_action_not_found", sourceGeneralAction: null };
  }

  const decision = decideGeneralActionEmbedding(action);

  if (decision.action === "skip") {
    return { skipReason: decision.reason, sourceGeneralAction: action };
  }

  const embedding = await reuseOrEmbed(ctx, {
    ownerUserId: action.ownerUserId,
    recordKind: "general_action",
    recordId: action.id,
    embeddedText: projectGeneralActionEmbeddedText(action),
    personId: null,
    trustLevel: "action_item",
    sensitivity: "normal",
    sourceUpdatedAt: action.updatedAt,
  });

  return { embedding, sourceGeneralAction: action };
}

/** Embeds Saved Item content; archive inclusion remains an explicit read policy. */
export async function processSavedItem(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
): Promise<EmbeddingProduced | { skipReason: string; sourceSavedItem: SavedItem | null }> {
  const item = await ctx.store.getSavedItemForEmbedding({
    ownerUserId: job.ownerUserId,
    savedItemId: job.recordId,
  });
  if (!item) {
    return { skipReason: "saved_item_not_found", sourceSavedItem: null };
  }
  const decision = decideSavedItemEmbedding(item);
  if (decision.action === "skip") {
    return { skipReason: decision.reason, sourceSavedItem: item };
  }
  const embedding = await reuseOrEmbed(ctx, {
    ownerUserId: item.ownerUserId,
    recordKind: "saved_item",
    recordId: item.id,
    embeddedText: projectSavedItemEmbeddedText(item),
    personId: null,
    trustLevel: "saved_context",
    sensitivity: "normal",
    sourceUpdatedAt: item.updatedAt,
  });
  return { embedding, sourceSavedItem: item };
}

/**
 * Embeds an Asset anchor. Mirrors {@link processGeneralAction}: skip when the asset is
 * gone or not durable (a `suggested`/`dismissed` proposal must never be retrievable as
 * a thing the user owns), reuse a fingerprint-matching embedding, else embed and upsert.
 * An Asset is not person-centered context, so its embedding carries no person; scope is
 * enforced at the Asset Search seam, not here — an asset is embedded once and filtered
 * per caller on read (#204).
 */
export async function processAsset(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
): Promise<EmbeddingProduced | { skipReason: string; sourceAsset: Asset | null }> {
  const asset = await ctx.store.getAssetForEmbedding({
    ownerUserId: job.ownerUserId,
    assetId: job.recordId,
  });

  if (!asset) {
    return { skipReason: "asset_not_found", sourceAsset: null };
  }

  const decision = decideAssetEmbedding(asset);

  if (decision.action === "skip") {
    return { skipReason: decision.reason, sourceAsset: asset };
  }

  const embedding = await reuseOrEmbed(ctx, {
    ownerUserId: asset.ownerUserId,
    recordKind: "asset",
    recordId: asset.id,
    embeddedText: projectAssetEmbeddedText(asset),
    personId: null,
    trustLevel: "asset_anchor",
    sensitivity: "normal",
    sourceUpdatedAt: asset.updatedAt,
  });

  return { embedding, sourceAsset: asset };
}

/**
 * Embeds an Asset Memory — the fact itself, folded together with the asset it belongs
 * to, so a fuzzy question about the thing ("anything for the kitchen fridge") retrieves
 * the precise fact rather than the asset blur. Skips when the memory is gone, dismissed,
 * or its asset is not durable. Suggested memories *are* embedded so an owner-only review
 * surface can find grounded proposals; the search seam — never the embedder — enforces
 * that they stay owner-only (#204).
 */
export async function processAssetMemory(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
): Promise<EmbeddingProduced | { skipReason: string; sourceAssetMemory: AssetMemory | null }> {
  const found = await ctx.store.getAssetMemoryForEmbedding({
    ownerUserId: job.ownerUserId,
    assetMemoryId: job.recordId,
  });

  if (!found) {
    return { skipReason: "asset_memory_not_found", sourceAssetMemory: null };
  }

  const { memory, asset } = found;
  const decision = decideAssetMemoryEmbedding(memory, asset);

  if (decision.action === "skip") {
    return { skipReason: decision.reason, sourceAssetMemory: memory };
  }

  const embedding = await reuseOrEmbed(ctx, {
    ownerUserId: memory.ownerUserId,
    recordKind: "asset_memory",
    recordId: memory.id,
    embeddedText: projectAssetMemoryEmbeddedText(memory, asset),
    personId: null,
    trustLevel: "asset_fact",
    sensitivity: "normal",
    sourceUpdatedAt: memory.updatedAt,
  });

  return { embedding, sourceAssetMemory: memory };
}
