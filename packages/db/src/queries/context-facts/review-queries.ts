import { createHash } from "node:crypto";
import {
  acceptSuggestedContextFactInputSchema,
  type ContextFact,
  ContextFactConflictError,
  ContextFactValidationError,
  contextFactSchema,
  createSuggestedContextFactInputSchema,
  createSuggestedSelfContextFactInputSchema,
  dismissSuggestedContextFactInputSchema,
  normalizeContextFactContent,
  toContextFactView,
} from "@tendnote/domain";
import type { AffectedScope } from "../affected-scopes";
import { callerScopedSubjectFilter, sameInstant } from "./shared";
import type {
  AcceptSuggestedContextFactMutationInput,
  ContextFactAuditLogInput,
  ContextFactReviewDismissMutationOutcome,
  ContextFactReviewMatch,
  ContextFactReviewMutationOutcome,
  ContextFactStore,
  CreateContextFactMutationInput,
  CreateSuggestedContextFactMutationInput,
  CreateSuggestedSelfContextFactMutationInput,
  DismissSuggestedContextFactMutationInput,
  ListContextFactsInput,
  SuggestedContextFactMutationOutcome,
  SuggestedContextFactReviewResult,
} from "./types";

type ReviewFactMatchInput = {
  subject: ContextFact["subject"];
  callerUserId: string;
  category: ContextFact["category"];
  content: string;
  sensitivity: ContextFact["sensitivity"];
  excludingId?: string;
};

type AuditFact = Pick<
  ContextFact,
  "id" | "subject" | "category" | "lifecycle" | "sensitivity" | "provenance"
>;

type SuggestedFactCandidate = Pick<ContextFact, "subject" | "category" | "content" | "sensitivity">;

/**
 * What Review needs to handle a household-owned suggestion.
 *
 * Injected rather than reconstructed here, so this file never grows a second
 * opinion about who may resolve a shared suggestion. `proveFacts` is the #380
 * proof seam; `activeMemberUserIds` exists only for dismissal suppression, which
 * is a household-wide fact and therefore cannot be read from one actor's audit
 * trail alone.
 */
export type ContextFactHouseholdReview = {
  callerHouseholdId: (callerUserId: string) => Promise<string | null>;
  proveFacts: (input: {
    callerUserId: string;
    operation: "view" | "update" | "archive";
    facts: readonly ContextFact[];
  }) => Promise<ContextFact[]>;
  activeMemberUserIds: (householdId: string) => Promise<string[]>;
};

export type ContextFactReviewQueryContext = {
  store: ContextFactStore;
  householdReview?: ContextFactHouseholdReview;
  maxPendingSuggestedContextFacts?: number;
  requireVerifiedCaller: (callerUserId: string) => Promise<string>;
  assertSubjectBelongsToCaller: (input: {
    callerUserId: string;
    subject: CreateContextFactMutationInput["subject"];
  }) => Promise<void>;
  findActiveMatch: (input: ReviewFactMatchInput) => Promise<ContextFactReviewMatch | null>;
  affectedScopesForFact: (fact: ContextFact, callerUserId: string) => Promise<AffectedScope[]>;
  recordAudit: (input: {
    ownerUserId: string;
    action: string;
    fact: AuditFact;
    metadataJson?: Record<string, unknown>;
  }) => Promise<void>;
  auditLogInput: (input: {
    ownerUserId: string;
    action: string;
    fact: AuditFact;
    metadataJson?: Record<string, unknown>;
  }) => ContextFactAuditLogInput;
};

type SuggestionSuppressionInput = {
  subject: ContextFact["subject"];
  category: ContextFact["category"];
  content: string;
  sensitivity: ContextFact["sensitivity"];
  provenance: ContextFact["provenance"];
};

function hashSuggestionSuppression(
  input: SuggestionSuppressionInput,
  provenance: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        subject: input.subject,
        category: input.category,
        content: normalizeContextFactContent(input.content),
        sensitivity: input.sensitivity,
        provenance,
      }),
    )
    .digest("hex");
}

/**
 * Identifies the suggestion an owner rejected, so the same one is not proposed again.
 *
 * Provenance contributes only `channel` and `origin`. `sourceRecordId` names the
 * session that happened to raise the suggestion, which is different on every import
 * and would therefore make a dismissal expire the moment the owner imported again.
 * What the owner rejected is the statement, not the sitting it came from.
 */
function suggestionSuppressionKey(input: SuggestionSuppressionInput): string {
  return hashSuggestionSuppression(input, {
    channel: input.provenance.channel,
    origin: input.provenance.origin,
  });
}

/**
 * The keys a stored dismissal may be recorded under: the current one, plus the
 * pre-#352 shape that hashed the whole provenance object.
 *
 * Dropping `sourceRecordId` changed the hash input for every suggestion, not just
 * the imports it was fixing - even an ambient one, whose source id was already
 * null, serializes differently now. Without this, deploying the fix would quietly
 * resurrect every suggestion an owner had already dismissed. Writes only ever use
 * the current key, so this can go once no `context_fact.review.dismiss` entry
 * predating #352 is still within retention.
 */
function suggestionSuppressionKeys(input: SuggestionSuppressionInput): readonly string[] {
  return [suggestionSuppressionKey(input), hashSuggestionSuppression(input, input.provenance)];
}

function hasGroundedEvidence(fact: ContextFact): boolean {
  return Boolean(fact.suggestionEvidence?.trim());
}

const sensitivityRank: Record<ContextFact["sensitivity"], number> = {
  normal: 0,
  sensitive: 1,
  restricted: 2,
};

function conflictError(match: ContextFactReviewMatch): ContextFactConflictError {
  return new ContextFactConflictError(
    match.kind === "duplicate"
      ? "An active fact already contains this statement. Edit the existing fact instead."
      : "This suggestion conflicts with an active fact. Edit the existing fact instead.",
    match.fact.id,
  );
}

async function findSuggestedFact(
  store: ContextFactStore,
  input: {
    callerUserId: string;
    subject: ContextFact["subject"];
    category: ContextFact["category"];
    content: string;
    sensitivity: ContextFact["sensitivity"];
  },
): Promise<ContextFact | null> {
  const facts = await store.listContextFacts({
    ...callerScopedSubjectFilter(input.subject, input.callerUserId),
    lifecycle: "suggested",
  });
  return (
    facts
      .map((fact) => contextFactSchema.parse(fact))
      .find(
        (fact) =>
          hasGroundedEvidence(fact) &&
          fact.category === input.category &&
          fact.sensitivity === input.sensitivity &&
          normalizeContextFactContent(fact.content) === normalizeContextFactContent(input.content),
      ) ?? null
  );
}

type ParsedSuggestedContextFactInput = Pick<
  ContextFact,
  "subject" | "category" | "content" | "sensitivity" | "provenance"
> & {
  suggestionEvidence: string;
};

type SuggestedFactCreationResult = {
  fact: ContextFact;
  decision: "created" | "existing";
};

async function assertPendingSuggestionCapacity(input: {
  store: ContextFactStore;
  subject: ContextFact["subject"];
  callerUserId: string;
  maxPendingSuggestedContextFacts?: number;
}) {
  if (input.maxPendingSuggestedContextFacts === undefined) return;
  const pendingCount = await input.store.listContextFacts({
    ...callerScopedSubjectFilter(input.subject, input.callerUserId),
    lifecycle: "suggested",
  });
  if (pendingCount.length >= input.maxPendingSuggestedContextFacts) {
    throw new ContextFactValidationError(
      "The owner has reached the pending Suggested Context Fact limit.",
    );
  }
}

async function createOrReuseSuggestedFact(input: {
  store: ContextFactStore;
  callerUserId: string;
  parsed: ParsedSuggestedContextFactInput;
  maxPendingSuggestedContextFacts?: number;
}): Promise<SuggestedFactCreationResult> {
  const existingSuggested = await findSuggestedFact(input.store, {
    callerUserId: input.callerUserId,
    subject: input.parsed.subject,
    category: input.parsed.category,
    content: input.parsed.content,
    sensitivity: input.parsed.sensitivity,
  });
  if (existingSuggested) return { fact: existingSuggested, decision: "existing" };

  await assertPendingSuggestionCapacity({
    store: input.store,
    subject: input.parsed.subject,
    callerUserId: input.callerUserId,
    maxPendingSuggestedContextFacts: input.maxPendingSuggestedContextFacts,
  });

  try {
    const created = contextFactSchema.parse(
      await input.store.createContextFact({
        subject: input.parsed.subject,
        category: input.parsed.category,
        content: input.parsed.content,
        lifecycle: "suggested",
        sensitivity: input.parsed.sensitivity,
        provenance: input.parsed.provenance,
        suggestionEvidence: input.parsed.suggestionEvidence,
        creatorUserId: input.callerUserId,
        lastActorUserId: input.callerUserId,
        reviewedAt: null,
        archivedAt: null,
        activeHouseholdMemberUserId: input.callerUserId,
        ...(input.maxPendingSuggestedContextFacts !== undefined
          ? { pendingSuggestionLimit: input.maxPendingSuggestedContextFacts }
          : {}),
      }),
    );
    return { fact: created, decision: "created" };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Pending Context Fact suggestion limit reached."
    ) {
      throw new ContextFactValidationError(
        "The owner has reached the pending Suggested Context Fact limit.",
      );
    }
    if (error instanceof Error && error.message === "Context Fact already exists.") {
      const pending = await findSuggestedFact(input.store, {
        callerUserId: input.callerUserId,
        subject: input.parsed.subject,
        category: input.parsed.category,
        content: input.parsed.content,
        sensitivity: input.parsed.sensitivity,
      });
      if (pending) return { fact: pending, decision: "existing" };
    }
    throw error;
  }
}

export function createContextFactReviewQueries(context: ContextFactReviewQueryContext) {
  const {
    store,
    householdReview,
    maxPendingSuggestedContextFacts,
    requireVerifiedCaller,
    assertSubjectBelongsToCaller,
    findActiveMatch,
    affectedScopesForFact,
    recordAudit,
    auditLogInput,
  } = context;

  /**
   * Reads one suggestion the caller may resolve, whichever subject owns it.
   *
   * A Self suggestion is found by owner. A household one is found by the
   * caller's own active membership and then re-proved, so a member who left
   * between the render and the press gets the same nothing as a stranger.
   */
  async function readResolvableSuggestion(
    callerUserId: string,
    contextFactId: string,
  ): Promise<ContextFact | null> {
    const own = await store.getContextFact({ contextFactId, subjectUserId: callerUserId });
    if (own?.subject.kind === "self") return contextFactSchema.parse(own);
    if (!householdReview) return null;

    const householdId = await householdReview.callerHouseholdId(callerUserId);
    if (!householdId) return null;
    const row = await store.getContextFact({
      contextFactId,
      householdIds: [householdId],
      activeHouseholdMemberUserId: callerUserId,
    });
    if (!row) return null;
    const [proven] = await householdReview.proveFacts({
      callerUserId,
      operation: "update",
      facts: [contextFactSchema.parse(row)],
    });
    return proven ?? null;
  }

  /** Pending household suggestions the caller may currently see, proof-gated. */
  async function householdSuggestions(callerUserId: string): Promise<ContextFact[]> {
    if (!householdReview) return [];
    const householdId = await householdReview.callerHouseholdId(callerUserId);
    if (!householdId) return [];
    const rows = await store.listContextFacts({
      householdIds: [householdId],
      activeHouseholdMemberUserId: callerUserId,
      lifecycle: "suggested",
    });
    return householdReview.proveFacts({
      callerUserId,
      operation: "view",
      facts: rows.map((row) => contextFactSchema.parse(row)),
    });
  }

  /**
   * Every audit trail a dismissal of this subject could have been recorded in.
   *
   * A household dismissal is the household's, not the dismisser's: "suppress
   * this suggestion for everyone" is the whole contract, and reading only the
   * current caller's trail would let the same rejected statement come back the
   * moment a different member was the one it was proposed to. Bounded by the
   * seat limit, so this is a handful of reads, not a scan.
   */
  async function suppressionTrails(
    callerUserId: string,
    subject: ContextFact["subject"],
  ): Promise<string[]> {
    if (subject.kind === "self" || !householdReview) return [callerUserId];
    const members = await householdReview.activeMemberUserIds(subject.householdId);
    return members.includes(callerUserId) ? members : [...members, callerUserId];
  }

  async function anyTrailRecords(
    ownerUserIds: readonly string[],
    matches: (
      entry: Awaited<ReturnType<ContextFactStore["listAuditLogEntries"]>>[number],
    ) => boolean,
  ): Promise<boolean> {
    for (const ownerUserId of new Set(ownerUserIds)) {
      const entries = await store.listAuditLogEntries({ ownerUserId });
      if (entries.some(matches)) return true;
    }
    return false;
  }

  /** The household's members, when the suggestion itself is already gone. */
  async function householdTrailsForMissingSuggestion(callerUserId: string): Promise<string[]> {
    if (!householdReview) return [];
    const householdId = await householdReview.callerHouseholdId(callerUserId);
    return householdId ? householdReview.activeMemberUserIds(householdId) : [];
  }

  async function suggestedReviewForFact(
    fact: ContextFact,
    callerUserId: string,
  ): Promise<SuggestedContextFactReviewResult | null> {
    const parsed = contextFactSchema.parse(fact);
    const evidence = parsed.suggestionEvidence;
    if (!evidence?.trim()) return null;
    const activeMatch = await findActiveMatch({
      subject: parsed.subject,
      callerUserId,
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
      excludingId: parsed.id,
    });
    return {
      fact: parsed,
      evidence,
      activeMatch,
    };
  }

  async function requireSuggestedReview(fact: ContextFact, callerUserId: string) {
    const review = await suggestedReviewForFact(fact, callerUserId);
    if (!review) {
      throw new ContextFactValidationError(
        "That Suggested Context Fact has no grounded evidence and cannot be reviewed.",
      );
    }
    return review;
  }

  async function createSuggestedContextFact(
    input: CreateSuggestedContextFactMutationInput,
  ): Promise<SuggestedContextFactMutationOutcome> {
    const parsed = createSuggestedContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    await assertSubjectBelongsToCaller({ callerUserId, subject: parsed.subject });

    const suppressionKeys = suggestionSuppressionKeys({
      subject: parsed.subject,
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
      provenance: parsed.provenance,
    });
    const dismissedBefore = await anyTrailRecords(
      await suppressionTrails(callerUserId, parsed.subject),
      (entry) =>
        entry.action === "context_fact.review.dismiss" &&
        typeof entry.metadataJson.suppressionKey === "string" &&
        suppressionKeys.includes(entry.metadataJson.suppressionKey),
    );
    if (dismissedBefore) {
      throw new ContextFactValidationError("That Context Fact suggestion was already dismissed.");
    }

    const created = await createOrReuseSuggestedFact({
      store,
      callerUserId,
      parsed,
      maxPendingSuggestedContextFacts,
    });
    const review = await requireSuggestedReview(created.fact, callerUserId);

    if (created.decision === "existing") {
      return { result: review, decision: "existing", affectedScopes: [] };
    }

    await recordAudit({
      ownerUserId: callerUserId,
      action: "context_fact.suggest",
      fact: created.fact,
      metadataJson: {
        suggestionEvidenceLength: parsed.suggestionEvidence.length,
        sourceRecordId: parsed.provenance.sourceRecordId,
        activeMatchId: review.activeMatch?.fact.id ?? null,
        activeMatchKind: review.activeMatch?.kind ?? null,
      },
    });

    return {
      result: review,
      decision: "created",
      affectedScopes: await affectedScopesForFact(created.fact, callerUserId),
    };
  }

  async function createSuggestedSelfContextFact(
    input: CreateSuggestedSelfContextFactMutationInput,
  ): Promise<SuggestedContextFactMutationOutcome> {
    const parsed = createSuggestedSelfContextFactInputSchema.parse(input);
    return createSuggestedContextFact({
      callerUserId: parsed.callerUserId,
      subject: { kind: "self", userId: parsed.callerUserId },
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
      provenance: parsed.provenance,
      suggestionEvidence: parsed.suggestionEvidence,
    });
  }

  /**
   * The caller's pending suggestions, private and household alike.
   *
   * One queue rather than two, because the reviewer's question is the same
   * either way — is this worth keeping? — and a household suggestion that lived
   * somewhere else would be a second inbox for the same job. The subject travels
   * on each item, so a surface that only wants one kind filters for it.
   */
  async function listSuggestedContextFactReviews(input: ListContextFactsInput) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    const [own, shared] = await Promise.all([
      store.listContextFacts({ subjectUserId: callerUserId, lifecycle: "suggested" }),
      householdSuggestions(callerUserId),
    ]);
    const facts = [...own.map((fact) => contextFactSchema.parse(fact)), ...shared]
      .filter(hasGroundedEvidence)
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      )
      .slice(0, 6);
    return Promise.all(facts.map((fact) => requireSuggestedReview(fact, callerUserId)));
  }

  async function getSuggestedContextFactReview(input: {
    callerUserId: string;
    contextFactId: string;
  }) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    const fact = await readResolvableSuggestion(callerUserId, input.contextFactId);
    if (!fact || fact.lifecycle !== "suggested") return null;
    return suggestedReviewForFact(fact, callerUserId);
  }

  async function loadSuggestedAcceptance(input: AcceptSuggestedContextFactMutationInput) {
    const parsed = acceptSuggestedContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const existing = await readResolvableSuggestion(callerUserId, parsed.contextFactId);
    if (!existing) {
      throw new ContextFactValidationError("That Suggested Context Fact is no longer available.");
    }
    return { parsed, callerUserId, existing };
  }

  async function activateSuggestedContextFact(input: {
    existing: ContextFact;
    callerUserId: string;
    expectedUpdatedAt?: Date;
    candidate: SuggestedFactCandidate;
  }): Promise<ContextFact> {
    const reviewedAt = new Date();
    let updated: ContextFact | null;
    try {
      updated = await store.updateContextFact({
        ...callerScopedSubjectFilter(input.existing.subject, input.callerUserId),
        contextFactId: input.existing.id,
        lifecycle: "suggested",
        expectedUpdatedAt: input.expectedUpdatedAt,
        patch: {
          category: input.candidate.category,
          content: input.candidate.content,
          sensitivity: input.candidate.sensitivity,
          lifecycle: "active",
          reviewedAt,
          archivedAt: null,
          lastActorUserId: input.callerUserId,
          updatedAt: reviewedAt,
        },
      });
    } catch (error) {
      const concurrentMatch = await findActiveMatch({
        ...input.candidate,
        callerUserId: input.callerUserId,
        excludingId: input.existing.id,
      });
      if (concurrentMatch) throw conflictError(concurrentMatch);
      throw error;
    }
    if (updated) return contextFactSchema.parse(updated);

    const concurrentMatch = await findActiveMatch({
      ...input.candidate,
      callerUserId: input.callerUserId,
      excludingId: input.existing.id,
    });
    if (concurrentMatch) throw conflictError(concurrentMatch);
    throw new ContextFactValidationError(
      "That suggestion changed elsewhere. Refresh the review and try again.",
    );
  }

  async function restoreSuggestedContextFact(fact: ContextFact, callerUserId: string) {
    const restored = await store.updateContextFact({
      ...callerScopedSubjectFilter(fact.subject, callerUserId),
      contextFactId: fact.id,
      lifecycle: "active",
      expectedUpdatedAt: fact.updatedAt,
      patch: {
        lifecycle: "suggested",
        reviewedAt: null,
        archivedAt: null,
        lastActorUserId: callerUserId,
        updatedAt: new Date(),
      },
    });
    if (!restored) {
      throw new ContextFactValidationError(
        "That accepted suggestion changed before the conflict could be restored.",
      );
    }
    return contextFactSchema.parse(restored);
  }

  async function acceptSuggestedContextFact(
    input: AcceptSuggestedContextFactMutationInput,
  ): Promise<ContextFactReviewMutationOutcome> {
    const { parsed, callerUserId, existing } = await loadSuggestedAcceptance(input);
    if (existing.lifecycle === "active") {
      return {
        result: toContextFactView(existing),
        decision: "existing",
        affectedScopes: [],
      };
    }
    if (existing.lifecycle !== "suggested") {
      throw new ContextFactValidationError("That Suggested Context Fact is no longer available.");
    }
    if (!hasGroundedEvidence(existing)) {
      throw new ContextFactValidationError(
        "That Suggested Context Fact has no grounded evidence and cannot be accepted.",
      );
    }
    if (parsed.expectedUpdatedAt && !sameInstant(parsed.expectedUpdatedAt, existing.updatedAt)) {
      throw new ContextFactValidationError(
        "That suggestion changed elsewhere. Refresh the review and try again.",
      );
    }

    const edit = parsed.edit ?? {};
    const candidate = {
      subject: existing.subject,
      category: edit.category ?? existing.category,
      content: edit.content ?? existing.content,
      sensitivity: edit.sensitivity ?? existing.sensitivity,
    } as const;
    if (sensitivityRank[candidate.sensitivity] < sensitivityRank[existing.sensitivity]) {
      throw new ContextFactValidationError(
        "Reviewed sensitivity cannot be downgraded. Keep the current sensitivity or increase it.",
      );
    }
    const match = await findActiveMatch({
      ...candidate,
      callerUserId,
      excludingId: existing.id,
    });
    if (match) {
      throw conflictError(match);
    }

    const fact = await activateSuggestedContextFact({
      existing,
      callerUserId,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      candidate,
    });
    const concurrentMatch = await findActiveMatch({
      ...candidate,
      callerUserId,
      excludingId: fact.id,
    });
    if (concurrentMatch) {
      await restoreSuggestedContextFact(fact, callerUserId);
      throw conflictError(concurrentMatch);
    }
    await recordAudit({
      ownerUserId: callerUserId,
      action: "context_fact.review.accept",
      fact,
      metadataJson: {
        previousLifecycle: "suggested",
        edited: Object.keys(edit).length > 0,
        suggestionEvidenceRetained: fact.suggestionEvidence !== null,
      },
    });
    return {
      result: toContextFactView(fact),
      decision: "accepted",
      affectedScopes: await affectedScopesForFact(fact, callerUserId),
    };
  }

  async function dismissSuggestedContextFact(
    input: DismissSuggestedContextFactMutationInput,
  ): Promise<ContextFactReviewDismissMutationOutcome> {
    const parsed = dismissSuggestedContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const existing = await readResolvableSuggestion(callerUserId, parsed.contextFactId);
    if (!existing) {
      // Already gone. If this caller's household resolved it a moment ago, the
      // second press is the state they wanted, not an error to explain.
      const trails = householdReview
        ? [callerUserId, ...(await householdTrailsForMissingSuggestion(callerUserId))]
        : [callerUserId];
      const dismissedBefore = await anyTrailRecords(
        trails,
        (entry) =>
          entry.action === "context_fact.review.dismiss" && entry.entityId === parsed.contextFactId,
      );
      if (dismissedBefore) {
        return {
          result: { dismissedContextFactId: parsed.contextFactId },
          affectedScopes: [],
        };
      }
      throw new ContextFactValidationError("That Suggested Context Fact is no longer available.");
    }
    if (existing.lifecycle !== "suggested") {
      throw new ContextFactValidationError("That Suggested Context Fact is no longer available.");
    }
    if (parsed.expectedUpdatedAt && !sameInstant(parsed.expectedUpdatedAt, existing.updatedAt)) {
      throw new ContextFactValidationError(
        "That suggestion changed elsewhere. Refresh the review and try again.",
      );
    }

    const fact = contextFactSchema.parse(existing);
    const deleted = await store.deleteContextFact({
      ...callerScopedSubjectFilter(fact.subject, callerUserId),
      contextFactId: fact.id,
      lifecycle: "suggested",
      expectedUpdatedAt: fact.updatedAt,
      auditLogEntry: auditLogInput({
        ownerUserId: callerUserId,
        action: "context_fact.review.dismiss",
        fact,
        metadataJson: {
          previousLifecycle: "suggested",
          suppressionKey: suggestionSuppressionKey({
            subject: fact.subject,
            category: fact.category,
            content: fact.content,
            sensitivity: fact.sensitivity,
            provenance: fact.provenance,
          }),
          suggestionEvidenceRemoved: fact.suggestionEvidence !== null,
        },
      }),
    });
    if (!deleted) {
      throw new ContextFactValidationError(
        "That suggestion changed elsewhere. Refresh the review and try again.",
      );
    }
    return {
      result: { dismissedContextFactId: fact.id },
      affectedScopes: await affectedScopesForFact(fact, callerUserId),
    };
  }

  return {
    createSuggestedContextFact,
    createSuggestedSelfContextFact,
    listSuggestedContextFactReviews,
    getSuggestedContextFactReview,
    acceptSuggestedContextFact,
    dismissSuggestedContextFact,
  };
}
