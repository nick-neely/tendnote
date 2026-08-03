import { z } from "zod";
import { selfContextFactCategories } from "./context-fact-categories";
import { type Sensitivity, sensitivitySchema } from "./privacy";

export { selfContextFactCategories } from "./context-fact-categories";

const nonEmptyIdentifier = z.string().trim().min(1);
const contextFactSourceRecordIdSchema = nonEmptyIdentifier.max(128);
const contextFactContentSchema = z.string().trim().min(1).max(500);

/** A user-actionable failure from a Self or Household Context Fact mutation. */
export class ContextFactValidationError extends Error {
  override name = "ContextFactValidationError";
}

/** A likely correction must name the existing path instead of creating a contradiction. */
export class ContextFactConflictError extends ContextFactValidationError {
  override name = "ContextFactConflictError";

  constructor(
    message: string,
    readonly existingFactId: string,
  ) {
    super(message);
  }
}

export const contextFactSubjectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("self"),
      userId: nonEmptyIdentifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("household"),
      householdId: nonEmptyIdentifier,
    })
    .strict(),
]);

export const contextFactCategorySchema = z.enum([
  "background",
  "work",
  "location",
  "interest",
  "preference",
  "constraint",
  "composition",
  "other",
]);

export const selfContextFactCategorySchema =
  contextFactCategorySchema.extract(selfContextFactCategories);

export const contextFactLifecycleSchema = z.enum(["suggested", "active", "archived"]);

export const contextFactChannelSchema = z.enum([
  "onboarding",
  "account",
  "eve",
  "capture",
  "review",
  "ambient",
  "import",
]);

export const contextFactOriginSchema = z.enum(["direct", "ambient", "import"]);

export const contextFactVisibilitySchema = z.enum(["private", "household"]);

/**
 * Provenance is deliberately a small, review-safe record. Raw messages and
 * provider payloads belong to their source domains, not inside Context Facts.
 */
export const contextFactProvenanceSchema = z
  .object({
    channel: contextFactChannelSchema,
    origin: contextFactOriginSchema,
    sourceRecordId: contextFactSourceRecordIdSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const expectedChannel =
      value.origin === "ambient" ? "ambient" : value.origin === "import" ? "import" : null;
    if (expectedChannel && value.channel !== expectedChannel) {
      ctx.addIssue({
        code: "custom",
        path: ["channel"],
        message: `${value.origin} provenance must use the ${expectedChannel} channel.`,
      });
    }

    if (value.origin === "direct" && (value.channel === "ambient" || value.channel === "import")) {
      ctx.addIssue({
        code: "custom",
        path: ["origin"],
        message: "Ambient and imported channels require review-gated provenance.",
      });
    }
  });

export type ContextFactSubject = z.infer<typeof contextFactSubjectSchema>;
export type ContextFactCategory = z.infer<typeof contextFactCategorySchema>;
export type ContextFactLifecycle = z.infer<typeof contextFactLifecycleSchema>;
export type ContextFactChannel = z.infer<typeof contextFactChannelSchema>;
export type ContextFactOrigin = z.infer<typeof contextFactOriginSchema>;
export type ContextFactVisibility = z.infer<typeof contextFactVisibilitySchema>;
export type ContextFactProvenance = z.infer<typeof contextFactProvenanceSchema>;
export type ContextFactSensitivity = Sensitivity;

export const contextFactLifecycleActionSchema = z.enum(["archive", "restore"]);
export type ContextFactLifecycleAction = z.infer<typeof contextFactLifecycleActionSchema>;

export type ContextFactMutationDecision =
  | "created"
  | "updated"
  | "existing"
  | "accepted"
  | "archived"
  | "restored";

export type ContextFactDeleteResult = {
  deletedContextFactId: string;
};

const contextFactFieldsSchema = z.object({
  subject: contextFactSubjectSchema,
  category: contextFactCategorySchema,
  content: contextFactContentSchema,
  lifecycle: contextFactLifecycleSchema,
  sensitivity: sensitivitySchema,
  provenance: contextFactProvenanceSchema,
  suggestionEvidence: contextFactContentSchema.nullable(),
  creatorUserId: nonEmptyIdentifier,
  lastActorUserId: nonEmptyIdentifier,
  reviewedAt: z.date().nullable(),
  archivedAt: z.date().nullable(),
});

function addContextFactSubjectIssues(
  value: Pick<ContextFact, "subject" | "category">,
  ctx: z.RefinementCtx,
) {
  if (!isContextFactCategoryAllowedForSubject(value)) {
    ctx.addIssue({
      code: "custom",
      path: ["category"],
      message: "Composition is only valid for Household Context.",
    });
  }
}

export const contextFactSchema = contextFactFieldsSchema
  .extend({
    id: nonEmptyIdentifier,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .superRefine(addContextFactSubjectIssues);

export const persistContextFactSchema = contextFactFieldsSchema
  .extend({ id: nonEmptyIdentifier.optional() })
  .superRefine(addContextFactSubjectIssues);

export const createContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    subject: contextFactSubjectSchema,
    category: contextFactCategorySchema,
    content: contextFactContentSchema,
    sensitivity: sensitivitySchema.default("normal"),
    provenance: contextFactProvenanceSchema.default({
      channel: "account",
      origin: "direct",
      sourceRecordId: null,
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    addContextFactSubjectIssues(value, ctx);
    if (value.provenance.origin !== "direct") {
      ctx.addIssue({
        code: "custom",
        path: ["provenance", "origin"],
        message: "Direct Context Fact writes require direct provenance.",
      });
    }
  });

export const createSelfContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    category: contextFactCategorySchema,
    content: contextFactContentSchema,
    sensitivity: sensitivitySchema.default("normal"),
    provenance: contextFactProvenanceSchema
      .default({
        channel: "account",
        origin: "direct",
        sourceRecordId: null,
      })
      .refine((value) => value.origin === "direct", {
        message: "Self Context direct writes require direct provenance.",
        path: ["origin"],
      }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.category === "composition") {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Composition is only valid for Household Context.",
      });
    }
  });

export type ContextFact = z.infer<typeof contextFactSchema>;
export type PersistContextFact = z.infer<typeof persistContextFactSchema>;
export type CreateContextFactInput = z.input<typeof createContextFactInputSchema>;
export type CreateSelfContextFactInput = z.input<typeof createSelfContextFactInputSchema>;

/** The only fields an owner may correct before accepting a suggestion. */
export const contextFactReviewEditSchema = z
  .object({
    category: contextFactCategorySchema,
    content: contextFactContentSchema,
    sensitivity: sensitivitySchema,
  })
  .partial()
  .strict()
  .superRefine((value, ctx) => {
    if (value.category === "composition") {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Composition is only valid for Household Context.",
      });
    }
  });

export type ContextFactReviewEdit = z.input<typeof contextFactReviewEditSchema>;

export const createSuggestedContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    subject: contextFactSubjectSchema,
    category: contextFactCategorySchema,
    content: contextFactContentSchema,
    sensitivity: sensitivitySchema.default("normal"),
    provenance: contextFactProvenanceSchema,
    /** Bounded evidence shown to the owner during review. */
    suggestionEvidence: contextFactContentSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    addContextFactSubjectIssues(value, ctx);
    if (value.provenance.origin === "direct") {
      ctx.addIssue({
        code: "custom",
        path: ["provenance", "origin"],
        message: "Suggested Context Facts require review-gated provenance.",
      });
    }
  });

export type CreateSuggestedContextFactInput = z.input<typeof createSuggestedContextFactInputSchema>;

export const createSuggestedSelfContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    category: contextFactCategorySchema,
    content: contextFactContentSchema,
    sensitivity: sensitivitySchema.default("normal"),
    provenance: contextFactProvenanceSchema,
    suggestionEvidence: contextFactContentSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.category === "composition") {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Composition is only valid for Household Context.",
      });
    }
    if (value.provenance.origin === "direct") {
      ctx.addIssue({
        code: "custom",
        path: ["provenance", "origin"],
        message: "Suggested Context Facts require review-gated provenance.",
      });
    }
  });

export type CreateSuggestedSelfContextFactInput = z.input<
  typeof createSuggestedSelfContextFactInputSchema
>;

export const acceptSuggestedContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    contextFactId: nonEmptyIdentifier.max(128),
    expectedUpdatedAt: z.date().optional(),
    edit: contextFactReviewEditSchema.optional(),
  })
  .strict();

export type AcceptSuggestedContextFactInput = z.input<typeof acceptSuggestedContextFactInputSchema>;

export const dismissSuggestedContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    contextFactId: nonEmptyIdentifier.max(128),
    expectedUpdatedAt: z.date().optional(),
  })
  .strict();

export type DismissSuggestedContextFactInput = z.input<
  typeof dismissSuggestedContextFactInputSchema
>;

export type ContextFactReviewDismissResult = {
  dismissedContextFactId: string;
};

export const updateSelfContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    contextFactId: nonEmptyIdentifier.max(128),
    expectedUpdatedAt: z.date().optional(),
    category: contextFactCategorySchema,
    content: contextFactContentSchema,
    sensitivity: sensitivitySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.category === "composition") {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Composition is only valid for Household Context.",
      });
    }
  });

export type UpdateSelfContextFactInput = z.input<typeof updateSelfContextFactInputSchema>;

export const archiveSelfContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    contextFactId: nonEmptyIdentifier.max(128),
    expectedUpdatedAt: z.date().optional(),
  })
  .strict();

export type ArchiveSelfContextFactInput = z.input<typeof archiveSelfContextFactInputSchema>;

export const restoreSelfContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    contextFactId: nonEmptyIdentifier.max(128),
    /** Present for an authoritative Undo; absent for an explicit restore. */
    expectedArchivedAt: z.date().optional(),
  })
  .strict();

export type RestoreSelfContextFactInput = z.input<typeof restoreSelfContextFactInputSchema>;

export const deleteSelfContextFactInputSchema = z
  .object({
    callerUserId: nonEmptyIdentifier,
    contextFactId: nonEmptyIdentifier.max(128),
  })
  .strict();

export type DeleteSelfContextFactInput = z.input<typeof deleteSelfContextFactInputSchema>;

/** Context Facts can inform an answer, but their stored text is never authority. */
export const contextFactTrustSchema = z.literal("untrusted_data");
export const contextFactAuthoritySchema = z.literal("none");

const contextFactPublicSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self") }).strict(),
  z.object({ kind: z.literal("household") }).strict(),
]);

const contextFactPublicProvenanceSchema = z
  .object({
    channel: contextFactChannelSchema,
    origin: contextFactOriginSchema,
  })
  .strict();

/**
 * The product-facing view intentionally omits actor ids, source ids, and retained
 * suggestion evidence. Those values remain in the owner-scoped application record
 * and audit trail; About you only needs bounded provenance and dates.
 */
export const contextFactViewSchema = z
  .object({
    id: nonEmptyIdentifier,
    subject: contextFactPublicSubjectSchema,
    category: contextFactCategorySchema,
    content: contextFactContentSchema,
    lifecycle: contextFactLifecycleSchema,
    sensitivity: sensitivitySchema,
    provenance: contextFactPublicProvenanceSchema,
    reviewedAt: z.date().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    trust: contextFactTrustSchema,
    authority: contextFactAuthoritySchema,
    visibility: contextFactVisibilitySchema,
  })
  .strict();
export type ContextFactView = z.infer<typeof contextFactViewSchema>;

export function toContextFactView(fact: ContextFact): ContextFactView {
  return contextFactViewSchema.parse({
    id: fact.id,
    subject: { kind: fact.subject.kind },
    category: fact.category,
    content: fact.content,
    lifecycle: fact.lifecycle,
    sensitivity: fact.sensitivity,
    provenance: {
      channel: fact.provenance.channel,
      origin: fact.provenance.origin,
    },
    reviewedAt: fact.reviewedAt,
    archivedAt: fact.archivedAt,
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
    trust: "untrusted_data",
    authority: "none",
    visibility: contextFactVisibilityForSubject(fact.subject),
  });
}

export function contextFactSubjectId(subject: ContextFactSubject): string {
  return subject.kind === "self" ? subject.userId : subject.householdId;
}

export function contextFactVisibilityForSubject(
  subject: ContextFactSubject,
): ContextFactVisibility {
  return subject.kind === "self" ? "private" : "household";
}

export function canViewContextFact(input: {
  callerUserId: string;
  fact: Pick<ContextFact, "subject">;
  activeHouseholdIds?: readonly string[];
}): boolean {
  if (input.fact.subject.kind === "self") {
    return input.fact.subject.userId === input.callerUserId;
  }

  return input.activeHouseholdIds?.includes(input.fact.subject.householdId) === true;
}

export function canUseContextFactForOrientation(input: {
  callerUserId: string;
  fact: Pick<ContextFact, "subject" | "lifecycle" | "sensitivity">;
  activeHouseholdIds?: readonly string[];
}): boolean {
  return (
    input.fact.lifecycle === "active" &&
    input.fact.sensitivity !== "restricted" &&
    canViewContextFact(input)
  );
}

export function isContextFactCategoryAllowedForSubject(input: {
  category: ContextFactCategory;
  subject: ContextFactSubject;
}): boolean {
  return input.category !== "composition" || input.subject.kind === "household";
}

/** Normalize only for duplicate/correction comparison; the retained statement is unchanged. */
export function normalizeContextFactContent(content: string): string {
  return content
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const likelySingleValueCategories = new Set<ContextFactCategory>([
  "background",
  "work",
  "location",
]);

type ContextFactComparison = Pick<ContextFact, "subject" | "category" | "content" | "sensitivity">;

function hasSameContextFactSubjectAndCategory(
  candidate: ContextFactComparison,
  existing: ContextFactComparison,
): boolean {
  return (
    contextFactSubjectId(candidate.subject) === contextFactSubjectId(existing.subject) &&
    candidate.subject.kind === existing.subject.kind &&
    candidate.category === existing.category
  );
}

export function isDuplicateContextFact(input: {
  candidate: ContextFactComparison;
  existing: ContextFactComparison;
}): boolean {
  return (
    hasSameContextFactSubjectAndCategory(input.candidate, input.existing) &&
    input.candidate.sensitivity === input.existing.sensitivity &&
    normalizeContextFactContent(input.candidate.content) ===
      normalizeContextFactContent(input.existing.content)
  );
}

/**
 * Detect only deterministic, high-signal contradictions. Multiple interests,
 * preferences, and constraints are valid; current work/location/background values
 * are the bounded categories where a second active statement is likely a correction.
 */
export function isLikelyConflictingContextFact(input: {
  candidate: ContextFactComparison;
  existing: ContextFactComparison;
}): boolean {
  return (
    hasSameContextFactSubjectAndCategory(input.candidate, input.existing) &&
    !isDuplicateContextFact(input) &&
    (likelySingleValueCategories.has(input.candidate.category) ||
      normalizeContextFactContent(input.candidate.content) ===
        normalizeContextFactContent(input.existing.content))
  );
}

export function resolveContextFactTransition(
  current: ContextFactLifecycle,
  action: ContextFactLifecycleAction,
): ContextFactLifecycle {
  if (action === "archive" && current === "active") return "archived";
  if (action === "restore" && current === "archived") return "active";
  throw new ContextFactValidationError(`Cannot ${action} a Context Fact that is ${current}.`);
}
