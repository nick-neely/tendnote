import { z } from "zod";
import {
  generalActionAssetHintSchema,
  generalActionRecurrenceSchema,
  MAX_ASSET_HINTS,
} from "./general-actions";
import type { PrivacyScope } from "./privacy";
import { canExtractFromSourceRecord, type SourceRecord } from "./source-records";

/**
 * Phase 5 Source Record action extraction (ADRs 0151, 0152). This is the pure policy
 * and shape layer that mirrors suggested-memory extraction: a deterministic gate, a
 * bounded candidate contract, candidate validation, and a fail-closed scope resolver.
 * It carries no I/O so web, Eve, cron, and queue triggers can share one processor that
 * turns action-like captured context into review-gated Suggested General Actions rather
 * than hidden Source Record action metadata (ADR 0151).
 */
export const suggestedActionExtractionPromptVersion = "suggested-action-extraction.v2";

/** An existing owner Area a candidate may file under; extraction never creates Areas. */
export type SuggestedActionExtractionArea = {
  id: string;
  name: string;
};

/**
 * Everything the extraction adapter sees for one source record: the grounding content
 * plus the two owner-scoped enrichment sets a candidate may reference by id — the people
 * the record already resolves to and the owner's existing Areas. The adapter never
 * invents people or Areas; an unmatched reference is simply dropped in validation.
 */
export type SuggestedActionExtractionInput = {
  sourceRecord: Pick<
    SourceRecord,
    "id" | "content" | "ownerUserId" | "sensitivity" | "scope" | "importance"
  >;
  resolvedPeople: Array<{ id: string; displayName: string }>;
  availableAreas: SuggestedActionExtractionArea[];
};

/**
 * A single proposed action distilled from a source record. Only `title` is required;
 * every other field is optional enrichment. `reason` is captured into the proposal's
 * notes, while timing, recurrence, Area, asset hints, people links, and scope map onto
 * real Suggested General Action fields. `scope` is deliberately limited to
 * private/household — a selected-shared audience is chosen only at acceptance, and
 * extraction defaults private and fails closed (ADRs 0140, 0151, 0153).
 */
export const suggestedActionCandidateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1000).optional(),
  dueAt: z.coerce.date().optional(),
  deferUntil: z.coerce.date().optional(),
  recurrence: generalActionRecurrenceSchema.optional(),
  areaId: z.string().min(1).optional(),
  assetHints: z.array(generalActionAssetHintSchema).max(MAX_ASSET_HINTS).optional(),
  personIds: z.array(z.string().min(1)).optional(),
  scope: z.enum(["private", "household"]).optional(),
});

export type SuggestedActionCandidate = z.infer<typeof suggestedActionCandidateSchema>;

export const suggestedActionExtractionAdapterResultSchema = z.object({
  candidates: z.array(z.unknown()).default([]),
});

export type SuggestedActionExtractionAdapterResult = z.infer<
  typeof suggestedActionExtractionAdapterResultSchema
>;

/**
 * Hard ceiling on how many proposals one source record may yield in a single run. A
 * prompt-injected or runaway record must not turn into hundreds of Suggested General
 * Actions, so the validator keeps at most this many candidates and ignores the rest.
 * The memory pipeline has no explicit cap; this picks a calm ceiling for actions.
 */
export const MAX_EXTRACTED_ACTION_CANDIDATES = 10;

export type SuggestedActionExtractionAdapter = {
  kind: "deterministic" | "fake" | "llm";
  model?: string;
  promptVersion?: string;
  extractActions: (
    input: SuggestedActionExtractionInput,
  ) => Promise<SuggestedActionExtractionAdapterResult>;
};

export type ValidateSuggestedActionCandidatesResult = {
  validCandidates: SuggestedActionCandidate[];
  /** Count of individually malformed candidates within a well-formed envelope. */
  invalidCandidateCount: number;
  /** True when the whole adapter payload was unusable (not a candidates envelope). */
  envelopeInvalid: boolean;
  /** Count of valid candidates dropped because the per-run cap was reached. */
  droppedOverCapCount: number;
};

/**
 * Validates and normalizes adapter output. A candidate is rejected only when its base
 * shape is unusable (no title, malformed timing). Unlike memory extraction, an unknown
 * person or Area does not invalidate the whole candidate — those are optional
 * enrichments, so an unresolvable `personId`/`areaId` is dropped and the action still
 * stands. This keeps a useful "replace the water filter" action even when the model
 * guesses a person or Area that the owner does not actually have.
 *
 * The output is capped at `MAX_EXTRACTED_ACTION_CANDIDATES`, so a runaway or injected
 * record can never persist an unbounded pile of proposals. Envelope-level invalidity is
 * reported separately from per-candidate invalidity, so a malformed whole payload is not
 * miscounted as "one bad candidate".
 */
export function validateSuggestedActionCandidates(
  adapterResult: unknown,
  input: {
    resolvedPeople: Array<{ id: string }>;
    availableAreas: SuggestedActionExtractionArea[];
  },
): ValidateSuggestedActionCandidatesResult {
  const parsedResult = suggestedActionExtractionAdapterResultSchema.safeParse(adapterResult);

  if (!parsedResult.success) {
    return {
      validCandidates: [],
      invalidCandidateCount: 0,
      envelopeInvalid: true,
      droppedOverCapCount: 0,
    };
  }

  const allowedPersonIds = new Set(input.resolvedPeople.map((person) => person.id));
  const allowedAreaIds = new Set(input.availableAreas.map((area) => area.id));
  const validCandidates: SuggestedActionCandidate[] = [];
  let invalidCandidateCount = 0;
  let droppedOverCapCount = 0;

  for (const candidate of parsedResult.data.candidates) {
    const parsed = suggestedActionCandidateSchema.safeParse(candidate);

    if (!parsed.success) {
      invalidCandidateCount += 1;
      continue;
    }

    // Cap enforcement: keep the first N valid candidates, count the rest as dropped.
    if (validCandidates.length >= MAX_EXTRACTED_ACTION_CANDIDATES) {
      droppedOverCapCount += 1;
      continue;
    }

    const personIds = parsed.data.personIds?.filter((personId) => allowedPersonIds.has(personId));
    const areaId =
      parsed.data.areaId !== undefined && allowedAreaIds.has(parsed.data.areaId)
        ? parsed.data.areaId
        : undefined;

    validCandidates.push({
      ...parsed.data,
      ...(personIds && personIds.length > 0 ? { personIds } : { personIds: undefined }),
      areaId,
    });
  }

  return { validCandidates, invalidCandidateCount, envelopeInvalid: false, droppedOverCapCount };
}

export type ActionExtractionSkipReason = "source_record_not_active" | "restricted_content";

export type ActionExtractionDecision =
  | { action: "extract" }
  | { action: "skip"; reason: ActionExtractionSkipReason };

/**
 * Deterministic gate for the action extraction processor. Unlike memory extraction,
 * action extraction is not person-gated — an action such as "replace the refrigerator
 * water filter" need not resolve to any person — so there is no `delay` on mention
 * resolution and no `no_linked_people` skip. It only refuses when the record cannot
 * yield proactive suggestions at all: it is not active, or it is restricted and the
 * user did not directly ask (ADRs 0004, 0058).
 */
export function decideActionExtraction(input: {
  sourceRecord: Pick<SourceRecord, "status" | "sensitivity">;
  directlyRequested?: boolean;
}): ActionExtractionDecision {
  if (input.sourceRecord.status !== "active") {
    return { action: "skip", reason: "source_record_not_active" };
  }

  if (
    !canExtractFromSourceRecord(input.sourceRecord, {
      directlyRequested: input.directlyRequested,
    })
  ) {
    return { action: "skip", reason: "restricted_content" };
  }

  return { action: "extract" };
}

/**
 * Resolves the visibility an extracted proposal argues for, fail-closed to private. A
 * proposal only reaches household visibility when the owner *themselves* scoped the
 * source record to a concrete household AND the candidate asks for household — capture
 * context such as a Discord guild/channel or a provider path never widens scope on its
 * own (ADR 0140, #169). `shared` is never proposed; a finer selected-shared audience is
 * chosen only at acceptance (ADR 0153). The returned pair is safe to hand straight to
 * `suggestGeneralAction`.
 */
export function resolveExtractedActionScope(input: {
  sourceRecord: Pick<SourceRecord, "scope" | "householdId">;
  candidateScope?: "private" | "household";
}): { scope: Exclude<PrivacyScope, "shared">; householdId: string | null } {
  if (
    input.candidateScope === "household" &&
    input.sourceRecord.scope === "household" &&
    input.sourceRecord.householdId
  ) {
    return { scope: "household", householdId: input.sourceRecord.householdId };
  }

  return { scope: "private", householdId: null };
}

/**
 * Idempotency key for a proposal within one source record: its normalized title. Two
 * runs over the same record must not create two proposals for the same action, and a
 * proposal already dismissed or ignored must not be reintroduced, so dedupe keys off
 * the title the reviewer sees rather than a fragile content hash.
 */
export function extractedActionDedupeKey(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Deterministic default adapter: it does not infer actions without a model, so it yields
 * nothing. It keeps the no-options processor path safe (never fabricating actions) while
 * the production runtime injects the LLM adapter and unit tests inject a fake one.
 */
export function createDeterministicSuggestedActionExtractionAdapter(): SuggestedActionExtractionAdapter {
  return {
    kind: "deterministic",
    promptVersion: suggestedActionExtractionPromptVersion,
    async extractActions() {
      return { candidates: [] };
    },
  };
}

/** Fake adapter returning fixed candidates, for exercising the processor in tests. */
export function createFakeSuggestedActionExtractionAdapter(
  candidates: unknown[],
): SuggestedActionExtractionAdapter {
  return {
    kind: "fake",
    promptVersion: suggestedActionExtractionPromptVersion,
    async extractActions() {
      return { candidates };
    },
  };
}
