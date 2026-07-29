import { z } from "zod";
import { assetMemoryValueSchema } from "./asset-memories";
import { assetKindSchema } from "./assets";
import { calendarEventStatusSchema } from "./calendar";
import { sensitivitySchema, visibilityChoiceSchema } from "./privacy";
import { savedItemKindSchema } from "./saved-items";

export const globalRecallFamilySchema = z.enum([
  "person",
  "relationship_context",
  "follow_up",
  "general_action",
  "asset",
  "asset_memory",
  "saved_item",
  "calendar_event",
]);

export const globalRecallFilterSchema = z.enum([
  "all",
  "people",
  "follow_ups",
  "actions",
  "assets",
  "saved_items",
  "calendar",
]);

export const globalRecallCanonicalKindSchema = z.enum([
  "person",
  "memory",
  "follow_up",
  "general_action",
  "asset",
  "asset_memory",
  "saved_item",
  "calendar_event",
]);

export const globalRecallGroundingKindSchema = z.enum([
  ...globalRecallCanonicalKindSchema.options,
  "source_record",
  "asset_evidence",
]);

export const globalRecallTrustSchema = z.enum([
  "identity_reference",
  "logged_context",
  "confirmed_fact",
  "follow_up",
  "action_item",
  "asset_anchor",
  "asset_fact",
  "saved_context",
  "provider_context",
]);

export const globalRecallMatchKindSchema = z.enum(["exact", "related"]);

/**
 * The floor a recall query has to clear: two consecutive letters or digits
 * somewhere in it. Punctuation and single initials are not a search, and the
 * seam rejects them.
 *
 * Exported rather than kept inside the refine because the surfaces that offer
 * recall need to hold their input at the same floor. Gating on trimmed length
 * alone is not the same test - `"!!"` and `"A B"` both clear two characters -
 * so a client that guessed would send a query the schema is certain to reject
 * and then report that rejection to the owner as a failed search.
 */
export function isMeaningfulRecallQuery(query: string): boolean {
  return /[\p{L}\p{N}]{2,}/u.test(query.trim());
}

const globalRecallInputObjectSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .refine(isMeaningfulRecallQuery, "Enter a meaningful search term."),
  family: globalRecallFilterSchema.default("all"),
  includeArchived: z.boolean().default(false),
  includeRestricted: z.boolean().default(false),
  matchKinds: z.array(globalRecallMatchKindSchema).min(1).max(2).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(12).default(12),
});

function requireRestrictedFamily(
  input: { includeRestricted: boolean; family: GlobalRecallFilter },
  context: z.RefinementCtx,
) {
  if (input.includeRestricted && input.family === "all") {
    context.addIssue({
      code: "custom",
      message: "Choose one record family before revealing restricted matches.",
      path: ["family"],
    });
  }
}

export const globalRecallInputSchema =
  globalRecallInputObjectSchema.superRefine(requireRestrictedFamily);

export const globalRecallToolInputSchema = globalRecallInputObjectSchema
  .omit({ offset: true })
  .superRefine(requireRestrictedFamily);

export const globalRecallCanonicalRefSchema = z.object({
  kind: globalRecallCanonicalKindSchema,
  id: z.string().min(1),
});

export const globalRecallGroundingRefSchema = z.object({
  kind: globalRecallGroundingKindSchema,
  id: z.string().min(1),
});

const globalRecallBaseShape = {
  canonical: globalRecallCanonicalRefSchema,
  label: z.string().min(1),
  supportingText: z.string().min(1),
  lifecycle: z.string().min(1),
  match: z.object({
    kind: globalRecallMatchKindSchema,
    reason: z.string().min(1),
    excerpt: z.string().min(1).nullable(),
  }),
  trust: globalRecallTrustSchema,
  sensitivity: sensitivitySchema,
  visibility: z
    .object({
      choice: visibilityChoiceSchema,
      label: z.string().min(1),
    })
    .nullable(),
  grounding: z.array(globalRecallGroundingRefSchema).min(1),
  href: z.string().min(1),
  parent: globalRecallCanonicalRefSchema.nullable(),
};

export const globalRecallResultSchema = z.discriminatedUnion("family", [
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("person"),
    details: z.object({ displayName: z.string().min(1) }),
  }),
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("relationship_context"),
    details: z.object({
      contextKind: z.enum(["memory", "logged_context"]),
      personDisplayName: z.string().min(1).nullable(),
    }),
  }),
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("follow_up"),
    details: z.object({
      dueAt: z.iso.datetime(),
      cadence: z.string().nullable(),
      personDisplayName: z.string().min(1).nullable(),
    }),
  }),
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("general_action"),
    details: z.object({
      status: z.string().min(1),
      isRoutine: z.boolean(),
      isSuggested: z.boolean(),
      areaId: z.string().nullable(),
    }),
  }),
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("asset"),
    details: z.object({ assetKind: assetKindSchema }),
  }),
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("asset_memory"),
    details: z.object({
      assetId: z.string().min(1),
      assetName: z.string().min(1),
      assetKind: assetKindSchema,
      value: assetMemoryValueSchema.nullable(),
    }),
  }),
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("saved_item"),
    details: z.object({ kind: savedItemKindSchema.nullable() }),
  }),
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("calendar_event"),
    details: z.object({
      start: z.iso.datetime(),
      end: z.iso.datetime(),
      allDay: z.boolean(),
      status: calendarEventStatusSchema,
      source: z.enum(["live", "cache"]),
      stale: z.boolean(),
      fetchedAt: z.iso.datetime(),
    }),
  }),
]);

export const globalRecallLimitationSchema = z.object({
  source: z.enum(["relationship", "assets", "saved_items", "follow_ups", "calendar"]),
  message: z.string().min(1),
});

export const globalRecallResponseSchema = z.object({
  query: z.string(),
  results: z.array(globalRecallResultSchema),
  limitations: z.array(globalRecallLimitationSchema),
  hasMore: z.boolean(),
});

export type GlobalRecallFamily = z.infer<typeof globalRecallFamilySchema>;
export type GlobalRecallFilter = z.infer<typeof globalRecallFilterSchema>;
export type GlobalRecallMatchKind = z.infer<typeof globalRecallMatchKindSchema>;
export type GlobalRecallInput = z.input<typeof globalRecallInputSchema>;
export type ParsedGlobalRecallInput = z.output<typeof globalRecallInputSchema>;
export type GlobalRecallResult = z.infer<typeof globalRecallResultSchema>;
export type GlobalRecallResponse = z.infer<typeof globalRecallResponseSchema>;
