import { z } from "zod";
import { generalActionRetrievalMetaSchema } from "./general-actions";
import { sensitivitySchema, visibilityChoiceSchema } from "./privacy";

// General Actions join people, memories, and source records as an exact-recall record
// kind, found by explicit text over their title and notes (ADR 0150; Phase 5 #184).
export const exactRecallRecordKindSchema = z.enum([
  "person",
  "memory",
  "source_record",
  "general_action",
]);

export const exactRecallTrustLevelSchema = z.enum([
  "identity_reference",
  "confirmed_fact",
  "logged_context",
  // A General Action is an owner-authored intention — its own trust register, distinct
  // from an identity reference, a confirmed fact, or logged relationship context.
  "action_item",
]);

export const searchRelationshipContextSchema = z.object({
  query: z.string().trim().min(1).max(400),
  personId: z.uuid().optional(),
  recordKinds: z.array(exactRecallRecordKindSchema).min(1).max(4).optional(),
  limit: z.number().int().min(1).max(20).default(8),
  directlyRequested: z.boolean().default(false),
  // Owner-only review context: when true, the caller's own `suggested` General Actions
  // may be found by exact recall so a review surface can look up grounded proposals. A
  // suggested proposal stays owner-only regardless — never scope-visible to a member
  // until accepted (ADRs 0151–0153, AC3).
  includeReviewGated: z.boolean().default(false),
});

export const exactRecallResultSchema = z.object({
  recordKind: exactRecallRecordKindSchema,
  recordId: z.string(),
  visibilityChoice: visibilityChoiceSchema.nullable(),
  visibilityLabel: z.string().nullable(),
  relatedPersonId: z.string().nullable(),
  relatedPersonDisplayName: z.string().nullable(),
  label: z.string(),
  snippet: z.string(),
  matchedFields: z.array(z.string()).min(1),
  rank: z.number(),
  trustLevel: exactRecallTrustLevelSchema,
  sensitivity: sensitivitySchema,
  // Present only for `general_action` results: narrows the kind to Action / Routine /
  // Suggested so a consumer needn't re-fetch the row (AC4). Absent/null for every other
  // kind, so existing person/memory/source-record producers need not set it.
  generalAction: generalActionRetrievalMetaSchema.nullable().optional(),
});

export type ExactRecallRecordKind = z.infer<typeof exactRecallRecordKindSchema>;
export type ExactRecallTrustLevel = z.infer<typeof exactRecallTrustLevelSchema>;
export type SearchRelationshipContextInput = z.input<typeof searchRelationshipContextSchema>;
export type ParsedSearchRelationshipContextInput = z.output<typeof searchRelationshipContextSchema>;
export type ExactRecallResult = z.infer<typeof exactRecallResultSchema>;
