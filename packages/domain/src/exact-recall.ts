import { z } from "zod";
import { sensitivitySchema } from "./privacy";

export const exactRecallRecordKindSchema = z.enum(["person", "memory", "source_record"]);

export const exactRecallTrustLevelSchema = z.enum([
  "identity_reference",
  "confirmed_fact",
  "logged_context",
]);

export const searchRelationshipContextSchema = z.object({
  query: z.string().trim().min(1).max(400),
  personId: z.uuid().optional(),
  recordKinds: z.array(exactRecallRecordKindSchema).min(1).max(3).optional(),
  limit: z.number().int().min(1).max(20).default(8),
  directlyRequested: z.boolean().default(false),
});

export const exactRecallResultSchema = z.object({
  recordKind: exactRecallRecordKindSchema,
  recordId: z.string(),
  relatedPersonId: z.string().nullable(),
  relatedPersonDisplayName: z.string().nullable(),
  label: z.string(),
  snippet: z.string(),
  matchedFields: z.array(z.string()).min(1),
  rank: z.number(),
  trustLevel: exactRecallTrustLevelSchema,
  sensitivity: sensitivitySchema,
});

export type ExactRecallRecordKind = z.infer<typeof exactRecallRecordKindSchema>;
export type ExactRecallTrustLevel = z.infer<typeof exactRecallTrustLevelSchema>;
export type SearchRelationshipContextInput = z.input<typeof searchRelationshipContextSchema>;
export type ParsedSearchRelationshipContextInput = z.output<typeof searchRelationshipContextSchema>;
export type ExactRecallResult = z.infer<typeof exactRecallResultSchema>;
