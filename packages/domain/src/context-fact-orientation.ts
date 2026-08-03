import { z } from "zod";
import {
  type ContextFact,
  canUseContextFactForOrientation,
  contextFactCategorySchema,
  contextFactChannelSchema,
  contextFactOriginSchema,
  contextFactSchema,
  contextFactSubjectSchema,
} from "./context-facts";
import { sensitivitySchema } from "./privacy";

/** The maximum measured JSON payload added to an Eve turn by automatic orientation. */
export const DEFAULT_ORIENTATION_CONTEXT_BUDGET_BYTES = 8_192;

const nonEmptyIdentifier = z.string().trim().min(1);

const orientationCanonicalSchema = z
  .object({
    type: z.literal("context_fact"),
    id: nonEmptyIdentifier,
  })
  .strict();

const orientationProvenanceSchema = z
  .object({
    channel: contextFactChannelSchema,
    origin: contextFactOriginSchema,
  })
  .strict();

/**
 * The exact record shape the runtime may hand to Eve. The trust and authority
 * markers are deliberately explicit: Context Fact text is data to reason about,
 * never a second instruction channel.
 */
export const orientationContextFactSchema = z
  .object({
    canonical: orientationCanonicalSchema,
    subject: contextFactSubjectSchema,
    category: contextFactCategorySchema,
    content: z.string().trim().min(1).max(500),
    trust: z.literal("untrusted_data"),
    authority: z.literal("none"),
    provenance: orientationProvenanceSchema,
    sensitivity: sensitivitySchema,
    confirmedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type OrientationContextFact = z.infer<typeof orientationContextFactSchema>;

export const orientationContextSchema = z
  .object({
    identity: z
      .object({
        kind: z.literal("authenticated_user"),
        userId: nonEmptyIdentifier,
      })
      .strict(),
    facts: z.array(orientationContextFactSchema),
    eligibleFactCount: z.number().int().nonnegative(),
    omittedFactCount: z.number().int().nonnegative(),
    budgetBytes: z.number().int().positive(),
  })
  .strict();

export type OrientationContext = z.infer<typeof orientationContextSchema>;

export type BuildOrientationContextInput = {
  callerUserId: string;
  facts: readonly ContextFact[];
  activeHouseholdIds?: readonly string[];
  maxBytes?: number;
};

export type OrientationContextBuildResult = {
  context: OrientationContext;
  /** Stable JSON encoding of `context`; the runtime adds its own delimiters. */
  serialized: string;
  serializedBytes: number;
};

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function subjectKey(fact: ContextFact): string {
  return fact.subject.kind === "self"
    ? `self:${fact.subject.userId}`
    : `household:${fact.subject.householdId}`;
}

function confirmationTime(fact: ContextFact): number {
  return (fact.reviewedAt ?? fact.updatedAt).getTime();
}

/** Newer confirmed facts win ties only after category/subject policy is applied. */
function compareRecentlyConfirmed(left: ContextFact, right: ContextFact): number {
  return (
    confirmationTime(right) - confirmationTime(left) ||
    right.updatedAt.getTime() - left.updatedAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function toOrientationFact(fact: ContextFact): OrientationContextFact {
  return orientationContextFactSchema.parse({
    canonical: { type: "context_fact", id: fact.id },
    subject: fact.subject,
    category: fact.category,
    content: fact.content,
    trust: "untrusted_data",
    authority: "none",
    provenance: {
      channel: fact.provenance.channel,
      origin: fact.provenance.origin,
    },
    sensitivity: fact.sensitivity,
    confirmedAt: fact.reviewedAt?.toISOString() ?? null,
    updatedAt: fact.updatedAt.toISOString(),
  });
}

function serializeContext(input: {
  callerUserId: string;
  facts: readonly ContextFact[];
  eligibleFactCount: number;
  budgetBytes: number;
}): { context: OrientationContext; serialized: string; serializedBytes: number } {
  const context = orientationContextSchema.parse({
    identity: { kind: "authenticated_user", userId: input.callerUserId },
    facts: input.facts.map(toOrientationFact),
    eligibleFactCount: input.eligibleFactCount,
    omittedFactCount: input.eligibleFactCount - input.facts.length,
    budgetBytes: input.budgetBytes,
  });
  const serialized = JSON.stringify(context);

  return { context, serialized, serializedBytes: utf8ByteLength(serialized) };
}

/**
 * Builds the deterministic, policy-filtered Orientation Context payload.
 * Storage is never bounded by this function: facts omitted under pressure remain
 * authoritative and can be loaded through exact retrieval later.
 */
export function buildOrientationContext(
  input: BuildOrientationContextInput,
): OrientationContextBuildResult {
  const callerUserId = input.callerUserId.trim();
  if (!callerUserId) throw new Error("Orientation Context requires a caller.");

  const maxBytes = input.maxBytes ?? DEFAULT_ORIENTATION_CONTEXT_BUDGET_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Orientation Context budget must be positive.");
  }

  const eligibleFacts = [
    ...new Map(
      input.facts
        .map((value) => contextFactSchema.parse(value))
        .filter((fact) =>
          canUseContextFactForOrientation({
            callerUserId,
            fact,
            activeHouseholdIds: input.activeHouseholdIds,
          }),
        )
        .map((fact) => [fact.id, fact] as const),
    ).values(),
  ].sort(compareRecentlyConfirmed);

  const empty = serializeContext({
    callerUserId,
    facts: [],
    eligibleFactCount: eligibleFacts.length,
    budgetBytes: maxBytes,
  });
  if (empty.serializedBytes > maxBytes) {
    throw new Error("Orientation Context budget is too small for its envelope.");
  }

  const all = serializeContext({
    callerUserId,
    facts: eligibleFacts,
    eligibleFactCount: eligibleFacts.length,
    budgetBytes: maxBytes,
  });
  if (all.serializedBytes <= maxBytes) return all;

  const selected = new Map<string, ContextFact>();
  const tryAdd = (candidate: ContextFact): boolean => {
    if (selected.has(candidate.id)) return false;
    const next = [...selected.values(), candidate].sort(compareRecentlyConfirmed);
    const serialized = serializeContext({
      callerUserId,
      facts: next,
      eligibleFactCount: eligibleFacts.length,
      budgetBytes: maxBytes,
    });
    if (serialized.serializedBytes > maxBytes) return false;
    selected.set(candidate.id, candidate);
    return true;
  };

  // One deterministic reserve per subject keeps a future Self/Household pack
  // from becoming all one subject when the bounded pack is under pressure.
  for (const key of [...new Set(eligibleFacts.map(subjectKey))].sort()) {
    for (const candidate of eligibleFacts.filter((fact) => subjectKey(fact) === key)) {
      if (tryAdd(candidate)) break;
    }
  }

  // Category coverage is a fixed policy order, not a learned importance score.
  for (const category of contextFactCategorySchema.options) {
    for (const candidate of eligibleFacts.filter((fact) => fact.category === category)) {
      if (tryAdd(candidate)) break;
    }
  }

  // Finally fill remaining space with recently confirmed facts.
  for (const candidate of eligibleFacts) tryAdd(candidate);

  return serializeContext({
    callerUserId,
    facts: [...selected.values()].sort(compareRecentlyConfirmed),
    eligibleFactCount: eligibleFacts.length,
    budgetBytes: maxBytes,
  });
}
