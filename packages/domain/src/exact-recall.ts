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

export const exactRecallVisibilityScopeSchema = z.enum(["all_visible", "private_only", "shared"]);

export const searchRelationshipContextSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe(
      "The literal text to find, in the user's own words. This is exact text search: " +
        "wording that is merely similar will not match (use semantic search for that).",
    ),
  personId: z
    .uuid()
    .optional()
    .describe(
      "Narrow to one person, using an id resolved with `search_people` - never a guessed " +
        "one. Omit to search across everyone.",
    ),
  recordKinds: z
    .array(exactRecallRecordKindSchema)
    .min(1)
    .max(4)
    .optional()
    .describe("Restrict to particular record kinds. Omit for all of them, which is usually right."),
  visibilityScope: exactRecallVisibilityScopeSchema
    .default("all_visible")
    .describe(
      "Filter before ranking and limiting: all caller-visible records, Only-me records only, or shared records only (Specific people and Whole household).",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe("Max records to return, best match first. Omit for the ordinary small set."),
  directlyRequested: z
    .boolean()
    .default(false)
    .describe(
      "Reveal restricted-sensitivity records, which every ordinary search withholds. Set " +
        "true ONLY when the user explicitly asked about that delicate context in this turn " +
        "and the query names it - never speculatively, and never to widen a thin result.",
    ),
  includeArchived: z
    .boolean()
    .default(false)
    .describe(
      "Include records the user archived. Leave false unless they explicitly ask for " +
        "archived or older context.",
    ),
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
