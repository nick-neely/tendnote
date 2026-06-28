import { z } from "zod";
import { confidenceSchema, privacyScopeSchema, sensitivitySchema, sourceSchema } from "./privacy";

export const sourceRecordStatusSchema = z.enum([
  "pending_resolution",
  "active",
  "dismissed",
  "archived",
]);

export const sourceRecordRetentionPolicySchema = z.enum([
  "retain",
  "summarize_then_delete",
  "delete_after_processing",
]);

export const sourceRecordPersonRoleSchema = z.enum(["primary", "mentioned"]);

export const unresolvedMentionStatusSchema = z.enum(["unresolved", "resolved", "dismissed"]);

export const sourceRecordSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  sourceType: sourceSchema.default("manual"),
  content: z.string().min(1),
  rawContent: z.string().nullable().optional(),
  retentionPolicy: sourceRecordRetentionPolicySchema.default("retain"),
  status: sourceRecordStatusSchema.default("active"),
  confidence: confidenceSchema.default("medium"),
  sensitivity: sensitivitySchema.default("normal"),
  scope: privacyScopeSchema.default("private"),
  importance: z.number().int().min(1).max(5).default(3),
  metadataJson: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createSourceRecordSchema = sourceRecordSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const sourceRecordPersonSchema = z.object({
  id: z.string(),
  sourceRecordId: z.string(),
  personId: z.string(),
  role: sourceRecordPersonRoleSchema.default("mentioned"),
  createdAt: z.date(),
});

export const unresolvedPersonMentionSchema = z.object({
  id: z.string(),
  sourceRecordId: z.string(),
  mentionText: z.string().min(1),
  candidatePersonIds: z.array(z.string()).default([]),
  status: unresolvedMentionStatusSchema.default("unresolved"),
  resolvedPersonId: z.string().nullable().optional(),
  createdAt: z.date(),
  resolvedAt: z.date().nullable().optional(),
});

/**
 * Metadata flag set when the user approves a logged note inline before (or as) it is
 * extracted: it pre-approves the note so the extraction pipeline saves whatever it
 * distills as a confirmed memory instead of a tentative suggestion. One key, shared by
 * the approve mutation and the extraction processor so the contract never drifts.
 */
export const SOURCE_RECORD_AUTO_APPROVE_KEY = "autoApproveMemories";

/** Whether a logged note was pre-approved, so its extracted memories skip review. */
export function sourceRecordAutoApprovesMemories(
  metadataJson: Record<string, unknown> | null | undefined,
): boolean {
  return metadataJson?.[SOURCE_RECORD_AUTO_APPROVE_KEY] === true;
}

export function canExtractFromSourceRecord(
  sourceRecord: Pick<SourceRecord, "status" | "sensitivity">,
  input: { directlyRequested?: boolean } = {},
) {
  if (sourceRecord.status !== "active") {
    return false;
  }

  return sourceRecord.sensitivity !== "restricted" || input.directlyRequested === true;
}

/**
 * Whether a source record may appear as logged context in proactive surfaces
 * (person profiles, the assistant). Only active records count as logged context
 * — pending/dismissed/archived records stay out — and restricted content is held
 * back unless the user directly requested it (ADR 0004, ADR 0058).
 */
export function canUseSourceRecordProactively(
  sourceRecord: Pick<SourceRecord, "status" | "sensitivity">,
  input: { directlyRequested?: boolean } = {},
) {
  if (sourceRecord.status !== "active") {
    return false;
  }

  return sourceRecord.sensitivity !== "restricted" || input.directlyRequested === true;
}

export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type CreateSourceRecordInput = z.infer<typeof createSourceRecordSchema>;
export type SourceRecordStatus = z.infer<typeof sourceRecordStatusSchema>;
export type SourceRecordRetentionPolicy = z.infer<typeof sourceRecordRetentionPolicySchema>;
export type SourceRecordPerson = z.infer<typeof sourceRecordPersonSchema>;
export type SourceRecordPersonRole = z.infer<typeof sourceRecordPersonRoleSchema>;
export type UnresolvedPersonMention = z.infer<typeof unresolvedPersonMentionSchema>;
export type UnresolvedMentionStatus = z.infer<typeof unresolvedMentionStatusSchema>;
