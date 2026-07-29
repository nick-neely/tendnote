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
  type EmbeddingDecision,
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
 * The columns an embedding row denormalizes from its source record that the content
 * fingerprint cannot see. The fingerprint covers `(recordKind, recordId, embeddedText)`
 * only, so every field here can change while the embedded text - and therefore the vector
 * - stays exactly right: a memory's sensitivity is edited, a source record's primary
 * person is relinked.
 *
 * `sourceUpdatedAt` is deliberately not part of this set. It is embed-time provenance, not
 * denormalized state to converge: nothing reads it, the migration-shape tripwire forbids it
 * ever becoming a retrieval gate again, and rewriting it here would restore the appearance
 * that it tracks source freshness - the exact misreading that once emptied the memory and
 * source-record halves of semantic recall.
 */
type DenormalizedEmbeddingMetadata = Pick<
  RelationshipContextEmbedding,
  "personId" | "trustLevel" | "sensitivity"
>;

function hasMetadataDrifted(
  existing: RelationshipContextEmbedding,
  live: DenormalizedEmbeddingMetadata,
) {
  return (
    existing.personId !== live.personId ||
    existing.trustLevel !== live.trustLevel ||
    existing.sensitivity !== live.sensitivity
  );
}

/**
 * Reuse the vector, but never the metadata around it.
 *
 * A matching fingerprint proves the *text* is unchanged; it says nothing about the
 * denormalized columns beside it, which the search seam compares against the live record.
 * Returning the found row untouched is therefore not a no-op - it lets an edited
 * sensitivity or a relinked person sit on the row permanently, because every later job
 * takes this same short-circuit and so can never repair it. The record either drops out of
 * semantic recall for good or is gated on a value the source no longer holds.
 */
async function converge(
  ctx: EmbeddingContext,
  existing: RelationshipContextEmbedding,
  live: DenormalizedEmbeddingMetadata,
): Promise<RelationshipContextEmbedding> {
  if (!hasMetadataDrifted(existing, live)) {
    return existing;
  }

  return ctx.store.refreshRelationshipContextEmbeddingMetadata({
    ownerUserId: existing.ownerUserId,
    embeddingId: existing.id,
    personId: live.personId,
    trustLevel: live.trustLevel,
    sensitivity: live.sensitivity,
  });
}

/**
 * Returns the existing embedding when its content fingerprint still matches (so
 * unchanged text never re-embeds), otherwise calls the adapter and upserts a
 * fresh one. The fingerprint/find/embed/upsert flow is identical for memories
 * and source records, so both record kinds route through here with only the
 * record-specific fields differing.
 *
 * A reused row still converges its {@link DenormalizedEmbeddingMetadata} - reuse is about
 * not paying for a second embedding call, not about leaving the row behind.
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
    return converge(ctx, existing, {
      personId: params.personId,
      trustLevel: params.trustLevel,
      sensitivity: params.sensitivity,
    });
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

/**
 * Fail the job and requeue it on a backoff so a transient error retries.
 *
 * Settled rather than plainly updated so that a rerun requested mid-run is consumed here
 * too. It needs no separate pass: the backoff already schedules one, and that retry reads
 * the record as it now stands.
 */
export async function failJob(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
  message: string,
  now: Date,
  retryDelayMs: number,
): Promise<ProcessEmbeddingJobResult> {
  const settlement = await ctx.store.settleEmbeddingJob({
    jobId: job.id,
    status: "failed",
    now,
    expectedClaimedAt: job.claimedAt ?? null,
    lastError: message,
    runAfter: new Date(now.getTime() + retryDelayMs),
    claimedAt: null,
  });

  if (!settlement.settled) {
    return { job: settlement.job, outcome: "not_claimable", embedding: null };
  }

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

  return { job: settlement.job, outcome: "failed", embedding: null, error: message };
}

type EmbeddingSkipReason = Extract<EmbeddingDecision, { action: "skip" }>["reason"];

/**
 * The one skip reason that must also unwrite what an earlier run wrote.
 *
 * Every other skip is a statement about eligibility - an archived record, an unresolved
 * mention - and the row from a previous run is simply withheld by the search predicates
 * until the record is eligible again, so keeping it spares a re-embed when it is. A
 * `restricted` record is different in kind: its row still holds the full `embedded_text`
 * it was embedded with while `normal`, plus the vector derived from that text, and the
 * owner has since said that content is not to be surfaced. Restricted text is never sent
 * to a provider, so no later job can overwrite the row either - the only way its content
 * stops existing is deletion.
 *
 * Pinned against the domain union, so renaming the reason there fails to compile here
 * rather than silently switching the scrub off.
 */
const RESTRICTED_SKIP_REASON = "restricted_content" satisfies EmbeddingSkipReason;

/**
 * Deletes the embedded representation of a record whose embed decision came back
 * `restricted_content`, and returns how many rows went. Every model and version for the
 * record is swept, not just the active pair.
 *
 * This runs *before* the job is recorded as skipped: a failed delete then surfaces as a
 * job failure and retries, rather than a skip logged over text that is still there. Only a
 * non-zero scrub is audited, so re-enqueueing a record that was restricted from the start
 * does not write a log entry per attempt.
 *
 * The search seam's `e.sensitivity = <record>.sensitivity` equality stays regardless: it is
 * what fails closed across the window between the sensitivity edit and this job running.
 */
export async function scrubRestrictedEmbeddings(
  ctx: EmbeddingContext,
  job: ProcessEmbeddingJobResult["job"],
  skipReason: string,
): Promise<number> {
  if (skipReason !== RESTRICTED_SKIP_REASON) {
    return 0;
  }

  const deleted = await ctx.store.deleteRelationshipContextEmbeddingsForRecord({
    ownerUserId: job.ownerUserId,
    recordKind: job.recordKind,
    recordId: job.recordId,
  });

  if (deleted === 0) {
    return 0;
  }

  await ctx.store.createAuditLogEntry({
    ownerUserId: job.ownerUserId,
    action: "embedding_job.restricted_scrubbed",
    entityType: "relationship_context_embedding_job",
    entityId: job.id,
    metadataJson: {
      recordKind: job.recordKind,
      recordId: job.recordId,
      deletedEmbeddings: deleted,
    },
  });

  return deleted;
}

/**
 * Terminal "skip" outcome: this record is not eligible for embedding.
 *
 * Terminal for this pass, not always for the job. Eligibility was decided against the
 * record as the run read it, so an edit that landed mid-run leaves the settled job back on
 * `pending` to decide again - which is how a record edited to `restricted` while a run was
 * in flight still reaches {@link scrubRestrictedEmbeddings}.
 */
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
  const settlement = await ctx.store.settleEmbeddingJob({
    jobId: job.id,
    status: "skipped",
    now,
    expectedClaimedAt: job.claimedAt ?? null,
    completedAt: now,
  });

  if (!settlement.settled) {
    return { job: settlement.job, outcome: "not_claimable", embedding: null };
  }

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
    job: settlement.job,
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
