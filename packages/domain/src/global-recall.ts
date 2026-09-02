import { z } from "zod";
import { assetMemoryValueSchema } from "./asset-memories";
import { assetKindSchema } from "./assets";
import { calendarEventStatusSchema } from "./calendar";
import {
  contextFactCategorySchema,
  contextFactChannelSchema,
  contextFactOriginSchema,
  selfContextFactCategorySchema,
} from "./context-facts";
import {
  RESTRICTED_REVEAL_REQUEST_DESCRIPTION,
  sensitivitySchema,
  visibilityChoiceSchema,
} from "./privacy";
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
  "self_context",
  "household_context",
  /**
   * Gift Plans (#389, #390). A member-owned planning record that reaches recall
   * through the Gift Plan seam's own proved search rather than through the shared
   * embedding index — a Gift Plan is deliberately not an embedded record kind, so
   * a Surprise Subject cannot meet one in ranked retrieval.
   */
  "gift_plan",
]);

/**
 * Self and Household Context are two families rather than one "context" family
 * because they are statements about two different subjects. A single family
 * would let a search for "we" answer with a member's private statement about
 * themselves and the household's shared statement side by side under one
 * heading, which is exactly the conflation the Household Context domain exists
 * to prevent.
 */
export const globalRecallFilterSchema = z.enum([
  "all",
  "people",
  "follow_ups",
  "actions",
  "assets",
  "saved_items",
  "calendar",
  "self_context",
  "household_context",
  "gift_plans",
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
  "context_fact",
  "gift_plan",
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
  "self_context",
  "household_context",
  /** A plan for one person and occasion — an intention, not a confirmed fact. */
  "gift_plan",
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

/**
 * The restricted unlock, said once so both the field and the refusal can quote it.
 *
 * Restricted context is revealed one record family at a time: a caller who has
 * asked for something delicate has asked about *something*, and a whole-surface
 * reveal is a sweep rather than an answer. The rule is enforced below and stated
 * on `includeRestricted` and `family` so a caller learns it before the call
 * rather than from the rejection (T11, T12).
 */
const RESTRICTED_UNLOCK_RULE =
  "Restricted matches are revealed one record family at a time, so `family` must name " +
  'a specific family (never "all") whenever `includeRestricted` is true.';

const globalRecallInputObjectSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .refine(isMeaningfulRecallQuery, "Enter a meaningful search term.")
    .describe(
      "What to look for, in the user's own words. Needs at least two letters or digits " +
        "together: punctuation and a single initial are not a search and are rejected.",
    ),
  family: globalRecallFilterSchema
    .default("all")
    .describe(
      'Narrow to one record family, or "all" (the default) to look across every family. ' +
        RESTRICTED_UNLOCK_RULE,
    ),
  includeArchived: z
    .boolean()
    .default(false)
    .describe(
      "Include records the user archived. Leave false unless they explicitly ask about " +
        "something archived or old.",
    ),
  includeRestricted: z
    .boolean()
    .default(false)
    .describe(
      "Reveal restricted-sensitivity records, which are withheld from every ordinary " +
        `search. ${RESTRICTED_REVEAL_REQUEST_DESCRIPTION} The query itself must name the ` +
        `target. ${RESTRICTED_UNLOCK_RULE}`,
    ),
  matchKinds: z
    .array(globalRecallMatchKindSchema)
    .min(1)
    .max(2)
    .optional()
    .describe(
      'Restrict results to "exact" matches, "related" (semantically similar) matches, or ' +
        "both. Omit for both, which is almost always right.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("How many results to skip, for a paged surface. Callers that do not page omit it."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(12)
    .default(12)
    .describe("Max results to return across all families. Omit for the full page."),
});

function requireRestrictedFamily(
  input: { includeRestricted: boolean; family: GlobalRecallFilter },
  context: z.RefinementCtx,
) {
  if (input.includeRestricted && input.family === "all") {
    context.addIssue({
      code: "custom",
      // Names the field to set and the value that is wrong, because this message is
      // the only thing a rejected caller (the model included) gets to read.
      message: `Set \`family\` to one specific record family before revealing restricted matches: ${RESTRICTED_UNLOCK_RULE} Pick the family the user's question is about, or drop \`includeRestricted\`.`,
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
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("self_context"),
    details: z.object({
      content: z.string().min(1),
      category: selfContextFactCategorySchema,
      categoryLabel: z.string().min(1),
      provenance: z.object({
        channel: contextFactChannelSchema,
        origin: contextFactOriginSchema,
      }),
    }),
  }),
  /**
   * A Gift Plan the caller is currently authorized to see.
   *
   * The details are the plan's own facts and nothing about who else is on it: no
   * co-planner list, no contributor names, no subject Person id. The counts come
   * from the same proved read as the plan, so there is no path by which a number
   * can describe a record its reader was refused — which is the whole of the
   * Surprise Subject rule as a recall row experiences it (ADR 0216).
   */
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("gift_plan"),
    details: z.object({
      subjectName: z.string().min(1),
      occasion: z.string().min(1),
      occasionOn: z.iso.datetime().nullable(),
      status: z.string().min(1),
      ideaCount: z.number().int().min(0),
      claimedIdeaCount: z.number().int().min(0),
    }),
  }),
  z.object({
    ...globalRecallBaseShape,
    family: z.literal("household_context"),
    details: z.object({
      content: z.string().min(1),
      // The full category enum, not the Self subset: `composition` is a category
      // only a household can hold, so narrowing this to the Self categories
      // would make the household's own "who lives here" statement unmodellable.
      category: contextFactCategorySchema,
      categoryLabel: z.string().min(1),
      provenance: z.object({
        channel: contextFactChannelSchema,
        origin: contextFactOriginSchema,
      }),
    }),
  }),
]);

export const globalRecallLimitationSchema = z.object({
  source: z.enum([
    "relationship",
    "assets",
    "saved_items",
    "follow_ups",
    "calendar",
    "self_context",
    "household_context",
    "gift_plans",
  ]),
  /** Calendar-only guidance that the owner must reconnect the provider grant. */
  requiresReauthorization: z.boolean().optional(),
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
