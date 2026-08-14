import { z } from "zod";
import type { AssetMemory } from "./asset-memories";
import { describeAssetMemoryValue } from "./asset-snapshots";
import { type Asset, assetLabelForKind, isDurableAssetStatus } from "./assets";
import {
  describeRecurrence,
  type GeneralAction,
  type GeneralActionRecurrence,
  generalActionRetrievalMetaSchema,
  isRetrievableGeneralActionStatus,
} from "./general-actions";
import { JOB_CREATE_OMIT, jobQueueMechanicsShape } from "./job-queue";
import type { memoryStatusSchema } from "./memories";
import { sensitivitySchema, type sourceSchema, visibilityChoiceSchema } from "./privacy";
import type { SavedItem } from "./saved-items";
import type { sourceRecordRetentionPolicySchema, sourceRecordStatusSchema } from "./source-records";

// General Actions join memories and source records as a semantic record kind: they are
// embedded on write and retrieved by meaning like the others, discriminated on this
// enum so a consumer can tell them apart (ADR 0150; Phase 5 #184). Assets and Asset
// Memories join them in Phase 6 (#204): they share this one embedding pipeline — the
// jobs, the fingerprinting, the adapter — but are retrieved through their own typed
// Asset Search contract, never through relationship retrieval.
export const semanticRecordKindSchema = z.enum([
  "memory",
  "source_record",
  "general_action",
  "asset",
  "asset_memory",
  "saved_item",
]);

/**
 * The subset of embeddable kinds that relationship retrieval may be asked for.
 * Assets are embedded in the same table but are *not* relationship context — a
 * relationship search can neither request nor return them (#204). Asset Search owns
 * its own typed contract in `asset-search.ts`.
 */
export const relationshipSemanticRecordKindSchema = z.enum([
  "memory",
  "source_record",
  "general_action",
]);

// `action_item` is the General Action trust level: an owner-authored intention that is
// neither a confirmed fact about a person nor logged relationship context. Kept as its
// own value so retrieval never mislabels an action's trust register. `asset_anchor` and
// `asset_fact` are the Asset registers: a thing the user owns, and a reviewed fact about
// that thing (#204).
export const semanticTrustLevelSchema = z.enum([
  "confirmed_fact",
  "logged_context",
  "action_item",
  "asset_anchor",
  "asset_fact",
  "saved_context",
]);

/**
 * The trust registers relationship retrieval can actually return. Assets are embedded
 * in the same table with their own registers, but they are not relationship context —
 * so the relationship result contract excludes them rather than leaving it to
 * convention (#204).
 */
export const relationshipSemanticTrustLevelSchema = z.enum([
  "confirmed_fact",
  "logged_context",
  "action_item",
]);

export const searchSemanticContextSchema = z.object({
  query: z.string().trim().min(1).max(400),
  personId: z.uuid().optional(),
  recordKinds: z.array(relationshipSemanticRecordKindSchema).min(1).max(3).optional(),
  limit: z.number().int().min(1).max(20).default(8),
  minimumSimilarity: z.number().min(0).max(1).default(0),
  directlyRequested: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  // Owner-only review context: when true, the caller's own `suggested` General Actions
  // may participate in retrieval so a review surface can find grounded proposals. A
  // suggested proposal is never scope-visible to a household member regardless of this
  // flag — review-gated rows are owner-only until accepted (ADRs 0151–0153, AC3).
  includeReviewGated: z.boolean().default(false),
});

export const searchSavedItemsSemanticSchema = z.object({
  query: z.string().trim().min(1).max(400),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(20).default(8),
  minimumSimilarity: z.number().min(0).max(1).default(0),
});

export const savedItemSemanticResultSchema = z.object({
  savedItemId: z.string(),
  title: z.string(),
  snippet: z.string(),
  similarity: z.number(),
  status: z.enum(["active", "archived"]),
  scope: z.enum(["private", "shared", "household"]),
});

export const embeddingJobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const relationshipContextEmbeddingSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  personId: z.string().nullable(),
  recordKind: semanticRecordKindSchema,
  recordId: z.string(),
  embedding: z.array(z.number()),
  embeddingModel: z.string().min(1),
  embeddingVersion: z.string().min(1),
  embeddingDimensions: z.number().int().positive(),
  embeddedText: z.string().min(1),
  contentFingerprint: z.string().min(1),
  trustLevel: semanticTrustLevelSchema,
  sensitivity: sensitivitySchema,
  sourceUpdatedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Relationship retrieval only ever yields relationship kinds — an Asset can never
// arrive here, so the result contract says so rather than leaving it to convention.
export const semanticRetrievalResultSchema = z.object({
  recordKind: relationshipSemanticRecordKindSchema,
  recordId: z.string(),
  visibilityChoice: visibilityChoiceSchema,
  visibilityLabel: z.string(),
  relatedPersonId: z.string().nullable(),
  relatedPersonDisplayName: z.string().nullable(),
  snippet: z.string(),
  similarity: z.number(),
  trustLevel: relationshipSemanticTrustLevelSchema,
  sensitivity: sensitivitySchema,
  sourceRefs: z
    .array(z.object({ kind: relationshipSemanticRecordKindSchema, id: z.string() }))
    .min(1),
  routing: z.object({
    personId: z.string().nullable(),
    recordKind: relationshipSemanticRecordKindSchema,
    recordId: z.string(),
  }),
  // Present only for `general_action` results: narrows the kind to Action / Routine /
  // Suggested so a consumer needn't re-fetch the row (AC4). Absent/null for every other
  // kind, so existing memory/source-record producers need not set it.
  generalAction: generalActionRetrievalMetaSchema.nullable().optional(),
});

export const createRelationshipContextEmbeddingSchema = relationshipContextEmbeddingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const embeddingJobSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  recordKind: semanticRecordKindSchema,
  recordId: z.string(),
  status: embeddingJobStatusSchema.default("pending"),
  ...jobQueueMechanicsShape,
  /**
   * When an enqueue arrived while this job was already `running`.
   *
   * A run reads its record once, at the top; an edit that lands after that read is invisible
   * to it, and the enqueue announcing the edit finds a job it cannot reopen - the run is
   * about to write a status of its own over anything the enqueue sets. So the request is
   * recorded here instead of flipping the status, and the run consumes it when it settles:
   * a marked job lands back on `pending` rather than on its verdict, guaranteeing exactly
   * one more pass over the record's current state (#330).
   *
   * Only a `running` job ever carries this. Settling clears it in the same statement that
   * writes the status, so the marker cannot outlive the run that was supposed to consume
   * it, and a rerun pass with no further edit settles normally - there is no loop.
   *
   * Deliberately not part of {@link jobQueueMechanicsShape}. The shared shape is the
   * mechanics every queue's table actually has; only this one has the column, and the
   * extraction queues earn it when the same interleaving is shown to bite them, not by
   * inheritance.
   */
  rerunRequestedAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createEmbeddingJobSchema = embeddingJobSchema.omit(JOB_CREATE_OMIT);

export type SemanticRecordKind = z.infer<typeof semanticRecordKindSchema>;
export type SemanticTrustLevel = z.infer<typeof semanticTrustLevelSchema>;
/** The narrowed kinds and registers relationship retrieval can actually return. */
export type RelationshipSemanticRecordKind = z.infer<typeof relationshipSemanticRecordKindSchema>;
export type RelationshipSemanticTrustLevel = z.infer<typeof relationshipSemanticTrustLevelSchema>;
export type RelationshipContextEmbedding = z.infer<typeof relationshipContextEmbeddingSchema>;
export type SearchSemanticContextInput = z.input<typeof searchSemanticContextSchema>;
export type ParsedSearchSemanticContextInput = z.output<typeof searchSemanticContextSchema>;
export type SemanticRetrievalResult = z.infer<typeof semanticRetrievalResultSchema>;
export type SearchSavedItemsSemanticInput = z.input<typeof searchSavedItemsSemanticSchema>;
export type ParsedSearchSavedItemsSemanticInput = z.output<typeof searchSavedItemsSemanticSchema>;
export type SavedItemSemanticResult = z.infer<typeof savedItemSemanticResultSchema>;
export type CreateRelationshipContextEmbeddingInput = z.infer<
  typeof createRelationshipContextEmbeddingSchema
>;
export type EmbeddingJobStatus = z.infer<typeof embeddingJobStatusSchema>;
export type EmbeddingJob = z.infer<typeof embeddingJobSchema>;
export type CreateEmbeddingJobInput = z.infer<typeof createEmbeddingJobSchema>;

export const claimableEmbeddingJobStatuses = [
  "pending",
  "failed",
] as const satisfies ReadonlyArray<EmbeddingJobStatus>;

/**
 * The job states an enqueue reopens outright, by setting the job back to `pending`.
 *
 * Both are verdicts on a state the record may since have left: `completed` embedded the
 * text it had then, `skipped` reported the eligibility it had then. An enqueue is how this
 * pipeline is told the record changed, so re-deciding is the whole point of the call.
 *
 * Leaving `skipped` terminal made every reversible skip a one-way door. A note logged
 * alongside an unresolved mention is skipped, and the resolve path's enqueue then handed
 * back the terminal job, so the note was never embedded once the mention was resolved. The
 * restricted scrub sharpens the same edge: with the row deleted, a record edited back out
 * of `restricted` would have stayed unretrievable forever.
 *
 * The three absent statuses are absent for three different reasons. `pending` is already
 * queued and `failed` already carries a retry backoff, so both will re-decide the record
 * without help. `running` is the one that needs help and cannot take it here: reopening a
 * job mid-flight only lets the finishing run write its verdict over the top. It records
 * {@link embeddingJobSchema}'s `rerunRequestedAt` instead (#330).
 */
export const reopenableEmbeddingJobStatuses = [
  "completed",
  "skipped",
] as const satisfies ReadonlyArray<EmbeddingJobStatus>;

export type ApprovedMemoryEmbeddingSource = {
  id: string;
  ownerUserId: string;
  personId: string;
  content: string;
  status: z.infer<typeof memoryStatusSchema>;
  sensitivity: z.infer<typeof sensitivitySchema>;
  updatedAt: Date;
};

export type SourceRecordEmbeddingSource = {
  id: string;
  ownerUserId: string;
  sourceType: z.infer<typeof sourceSchema>;
  content: string;
  rawContent?: string | null;
  retentionPolicy: z.infer<typeof sourceRecordRetentionPolicySchema>;
  status: z.infer<typeof sourceRecordStatusSchema>;
  sensitivity: z.infer<typeof sensitivitySchema>;
  metadataJson: Record<string, unknown>;
  updatedAt: Date;
};

export type SourceRecordEmbeddingPerson = {
  id: string;
  displayName: string;
};

export type GeneralActionEmbeddingSource = Pick<
  GeneralAction,
  "id" | "ownerUserId" | "title" | "notes" | "status" | "areaId" | "assetHints" | "updatedAt"
> & {
  recurrence: GeneralActionRecurrence | null;
};

export type EmbeddingDecision =
  | { action: "embed" }
  | {
      action: "skip";
      reason:
        | "memory_not_approved"
        | "empty_embedded_text"
        | "source_record_not_eligible"
        | "source_record_not_active"
        | "source_record_not_retained"
        | "source_record_not_user_created"
        | "source_record_not_note_or_summary"
        | "source_record_not_person_linked"
        | "source_record_has_unresolved_mentions"
        | "general_action_not_retrievable_status"
        | "asset_not_durable"
        | "asset_memory_not_retrievable_status"
        | "restricted_content";
    };

export type AssetEmbeddingSource = Pick<
  Asset,
  "id" | "ownerUserId" | "name" | "kind" | "status" | "updatedAt"
>;

export type AssetMemoryEmbeddingSource = Pick<
  AssetMemory,
  "id" | "ownerUserId" | "assetId" | "status" | "label" | "value" | "notes" | "updatedAt"
>;

export type SavedItemEmbeddingSource = Pick<
  SavedItem,
  "id" | "ownerUserId" | "kind" | "title" | "content" | "url" | "status" | "updatedAt"
>;

/** Saved Items stay embedded across active/archive; caller policy decides archive visibility. */
export function decideSavedItemEmbedding(
  item: Pick<SavedItemEmbeddingSource, "title" | "content" | "url">,
): EmbeddingDecision {
  return projectSavedItemEmbeddedText(item).length > 0
    ? { action: "embed" }
    : { action: "skip", reason: "empty_embedded_text" };
}

/** Canonical semantic text for a Saved Item, excluding immutable raw Source Record text. */
export function projectSavedItemEmbeddedText(
  item: Pick<SavedItemEmbeddingSource, "title" | "content" | "url">,
): string {
  return [item.title.trim(), item.content?.trim(), item.url?.trim()]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .replace(/[ \t]+/g, " ");
}

/**
 * An Asset is embedded while it is durable — active or archived. Archived things stay
 * retrievable on purpose: "what filter did the old fridge take?" is exactly the kind of
 * recall Asset Memory exists for; the *read* seam decides whether to show archived
 * results, not the embedder. Suggested and dismissed proposals are never embedded — an
 * un-reviewed guess must not be findable as if it were a thing the user owns (#204).
 */
export function decideAssetEmbedding(
  asset: Pick<AssetEmbeddingSource, "status" | "name" | "kind">,
): EmbeddingDecision {
  if (!isDurableAssetStatus(asset.status)) {
    return { action: "skip", reason: "asset_not_durable" };
  }

  if (projectAssetEmbeddedText(asset).length === 0) {
    return { action: "skip", reason: "empty_embedded_text" };
  }

  return { action: "embed" };
}

/**
 * The deterministic text an Asset is embedded from: its name and kind. Deliberately
 * thin — the Asset row is an *anchor*, and its facts live in Asset Memories, each
 * embedded on its own so a query can land on the precise fact rather than a blur of
 * everything the asset knows.
 */
export function projectAssetEmbeddedText(
  asset: Pick<AssetEmbeddingSource, "name" | "kind">,
): string {
  const name = asset.name.trim();
  if (name.length === 0) {
    return "";
  }

  return `Asset: ${name}\nKind: ${assetLabelForKind(asset.kind)}`.replace(/[ \t]+/g, " ");
}

/**
 * An Asset Memory is embedded while it is retrievable — `active` (a reviewed fact) or
 * `suggested` (a proposal). A suggested memory is embedded so an owner-only review
 * surface can find grounded proposals; it is never scope-visible to a household member,
 * and the read seam — not the embedder — enforces that (mirrors Suggested General
 * Actions, ADRs 0151–0153). A dismissed husk is not retrievable.
 */
export function decideAssetMemoryEmbedding(
  memory: Pick<AssetMemoryEmbeddingSource, "status" | "label" | "value" | "notes">,
  asset: Pick<AssetEmbeddingSource, "name" | "kind" | "status">,
): EmbeddingDecision {
  if (memory.status === "dismissed") {
    return { action: "skip", reason: "asset_memory_not_retrievable_status" };
  }

  // A memory is only as retrievable as the thing it hangs off: a fact about a
  // suggested (un-reviewed) asset must not be findable either.
  if (!isDurableAssetStatus(asset.status)) {
    return { action: "skip", reason: "asset_not_durable" };
  }

  if (projectAssetMemoryEmbeddedText(memory, asset).length === 0) {
    return { action: "skip", reason: "empty_embedded_text" };
  }

  return { action: "embed" };
}

/**
 * The deterministic text an Asset Memory is embedded from: the asset it belongs to,
 * then the fact itself and its notes. The asset's name and kind are folded in on
 * purpose — it is what makes "anything for the kitchen fridge" retrieve the *fridge's*
 * filter size rather than every filter size on file. Whitespace-collapsed so the
 * content fingerprint only moves when the meaningful text does.
 */
export function projectAssetMemoryEmbeddedText(
  memory: Pick<AssetMemoryEmbeddingSource, "label" | "value" | "notes">,
  asset: Pick<AssetEmbeddingSource, "name" | "kind">,
): string {
  const label = memory.label.trim();
  if (label.length === 0) {
    return "";
  }

  const value = describeAssetMemoryValue(memory.value);
  const notes = memory.notes?.trim() ?? "";
  const parts = [
    `Asset: ${asset.name.trim()} (${assetLabelForKind(asset.kind)})`,
    value ? `${label}: ${value}` : label,
    notes ? `Notes: ${notes}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts
    .join("\n")
    .trim()
    .replace(/[ \t]+/g, " ");
}

export function decideApprovedMemoryEmbedding(
  memory: ApprovedMemoryEmbeddingSource,
): EmbeddingDecision {
  if (memory.status !== "approved") {
    return { action: "skip", reason: "memory_not_approved" };
  }

  if (memory.sensitivity === "restricted") {
    return { action: "skip", reason: "restricted_content" };
  }

  if (projectApprovedMemoryEmbeddedText(memory).length === 0) {
    return { action: "skip", reason: "empty_embedded_text" };
  }

  return { action: "embed" };
}

export function projectApprovedMemoryEmbeddedText(
  memory: Pick<ApprovedMemoryEmbeddingSource, "content">,
) {
  return memory.content.trim().replace(/\s+/g, " ");
}

export function decideSourceRecordEmbedding(
  sourceRecord: SourceRecordEmbeddingSource,
  people: SourceRecordEmbeddingPerson[],
  unresolvedMentionCount = 0,
): EmbeddingDecision {
  if (sourceRecord.status !== "active") {
    return { action: "skip", reason: "source_record_not_active" };
  }

  if (sourceRecord.sensitivity === "restricted") {
    return { action: "skip", reason: "restricted_content" };
  }

  if (sourceRecord.retentionPolicy === "delete_after_processing") {
    return { action: "skip", reason: "source_record_not_retained" };
  }

  if (sourceRecord.sourceType !== "manual") {
    return { action: "skip", reason: "source_record_not_user_created" };
  }

  if (!isEligibleSourceRecordSemanticKind(sourceRecord)) {
    return { action: "skip", reason: "source_record_not_note_or_summary" };
  }

  if (people.length === 0) {
    return { action: "skip", reason: "source_record_not_person_linked" };
  }

  if (unresolvedMentionCount > 0) {
    return { action: "skip", reason: "source_record_has_unresolved_mentions" };
  }

  if (projectSourceRecordEmbeddedText(sourceRecord, people).length === 0) {
    return { action: "skip", reason: "empty_embedded_text" };
  }

  return { action: "embed" };
}

export function projectSourceRecordEmbeddedText(
  sourceRecord: Pick<SourceRecordEmbeddingSource, "content" | "metadataJson">,
  people: SourceRecordEmbeddingPerson[],
) {
  const personText = people
    .map((person) => person.displayName.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
  const parts = [
    personText ? `People: ${personText}` : null,
    interactionTypeFor(sourceRecord)
      ? `Interaction type: ${interactionTypeFor(sourceRecord)}`
      : null,
    `Logged context: ${sourceRecord.content}`,
  ].filter((part): part is string => Boolean(part));

  return parts
    .join("\n")
    .trim()
    .replace(/[ \t]+/g, " ");
}

function isEligibleSourceRecordSemanticKind(sourceRecord: SourceRecordEmbeddingSource) {
  const kind = sourceRecord.metadataJson.semanticRetrievalKind;

  return kind === undefined || kind === "note" || kind === "interaction_summary";
}

function interactionTypeFor(
  sourceRecord: Pick<SourceRecordEmbeddingSource, "metadataJson">,
): string | null {
  const value = sourceRecord.metadataJson.interactionType;

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Decides whether a General Action is eligible to be embedded. A General Action is
 * embedded while it is retrievable — live (open/deferred/paused) or a `suggested`
 * proposal — and skipped once terminal, `ignored`, or emptied to nothing (mirrors
 * `decideApprovedMemoryEmbedding` / `decideSourceRecordEmbedding`). General Actions
 * carry no sensitivity flag, so there is no restricted-content skip here. Scope and the
 * owner-only rule for suggested proposals are enforced pre-retrieval at the search
 * seam, not at embed time — an action is embedded once and filtered per caller on read.
 */
export function decideGeneralActionEmbedding(
  action: Pick<GeneralActionEmbeddingSource, "status" | "title" | "notes" | "assetHints"> & {
    recurrence: GeneralActionRecurrence | null;
  },
): EmbeddingDecision {
  if (!isRetrievableGeneralActionStatus(action.status) && action.status !== "suggested") {
    return { action: "skip", reason: "general_action_not_retrievable_status" };
  }

  if (projectGeneralActionEmbeddedText(action).length === 0) {
    return { action: "skip", reason: "empty_embedded_text" };
  }

  return { action: "embed" };
}

/**
 * Projects the deterministic text a General Action is embedded from: its title, then
 * any notes, asset-hint labels, and — for a Routine — its cadence, each on a labeled
 * line. Deterministic (asset hints are sorted) and whitespace-collapsed so the content
 * fingerprint only changes when the meaningful text does, exactly like the memory and
 * source-record projections. Title is always present (the schema requires a non-empty
 * title), so the projection is non-empty for any real action.
 */
export function projectGeneralActionEmbeddedText(
  action: Pick<GeneralActionEmbeddingSource, "title" | "notes" | "assetHints"> & {
    recurrence: GeneralActionRecurrence | null;
  },
): string {
  const title = action.title.trim();
  // Title is the only required field and anchors the embedded text; without it the
  // action has no meaningful content to embed (the schema forbids this — belt and
  // suspenders so a direct caller can't slip through an empty projection).
  if (title.length === 0) {
    return "";
  }

  const assetText = action.assetHints
    .map((hint) => hint.label.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
  const notes = action.notes?.trim() ?? "";
  const parts = [
    `Action: ${title}`,
    notes ? `Notes: ${notes}` : null,
    assetText ? `Assets: ${assetText}` : null,
    action.recurrence ? `Cadence: ${describeRecurrence(action.recurrence)}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts
    .join("\n")
    .trim()
    .replace(/[ \t]+/g, " ");
}
