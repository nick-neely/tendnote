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
  category: ContextFact["category"];
  content: string;
  sensitivity: ContextFact["sensitivity"];
  excludingId?: string;
};

type AuditFact = Pick<
  ContextFact,
  "id" | "subject" | "category" | "lifecycle" | "sensitivity" | "provenance"
>;

export type ContextFactReviewQueryContext = {
  store: ContextFactStore;
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

function scopedSubjectFilter(subject: ContextFact["subject"]) {
  return subject.kind === "self"
    ? { subjectUserId: subject.userId }
    : { householdIds: [subject.householdId] };
}

function sameInstant(left: Date | undefined, right: Date | null): boolean {
  return left !== undefined && right !== null && left.getTime() === right.getTime();
}

function suggestionSuppressionKey(input: {
  subject: ContextFact["subject"];
  category: ContextFact["category"];
  content: string;
  sensitivity: ContextFact["sensitivity"];
  provenance: ContextFact["provenance"];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        subject: input.subject,
        category: input.category,
        content: normalizeContextFactContent(input.content),
        sensitivity: input.sensitivity,
        provenance: input.provenance,
      }),
    )
    .digest("hex");
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
    subject: ContextFact["subject"];
    category: ContextFact["category"];
    content: string;
    sensitivity: ContextFact["sensitivity"];
  },
): Promise<ContextFact | null> {
  const facts = await store.listContextFacts({
    ...scopedSubjectFilter(input.subject),
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

export function createContextFactReviewQueries(context: ContextFactReviewQueryContext) {
  const {
    store,
    requireVerifiedCaller,
    assertSubjectBelongsToCaller,
    findActiveMatch,
    affectedScopesForFact,
    recordAudit,
    auditLogInput,
  } = context;

  async function suggestedReviewForFact(
    fact: ContextFact,
  ): Promise<SuggestedContextFactReviewResult | null> {
    const parsed = contextFactSchema.parse(fact);
    const evidence = parsed.suggestionEvidence;
    if (!evidence?.trim()) return null;
    const activeMatch = await findActiveMatch({
      subject: parsed.subject,
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

  async function requireSuggestedReview(fact: ContextFact) {
    const review = await suggestedReviewForFact(fact);
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

    const suppressionKey = suggestionSuppressionKey({
      subject: parsed.subject,
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
      provenance: parsed.provenance,
    });
    const dismissedBefore = (await store.listAuditLogEntries({ ownerUserId: callerUserId })).some(
      (entry) =>
        entry.action === "context_fact.review.dismiss" &&
        entry.metadataJson.suppressionKey === suppressionKey,
    );
    if (dismissedBefore) {
      throw new ContextFactValidationError("That Context Fact suggestion was already dismissed.");
    }

    const existingSuggested = await findSuggestedFact(store, {
      subject: parsed.subject,
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
    });
    if (existingSuggested) {
      return {
        result: await requireSuggestedReview(existingSuggested),
        decision: "existing",
        affectedScopes: [],
      };
    }

    let created: ContextFact;
    try {
      created = contextFactSchema.parse(
        await store.createContextFact({
          subject: parsed.subject,
          category: parsed.category,
          content: parsed.content,
          lifecycle: "suggested",
          sensitivity: parsed.sensitivity,
          provenance: parsed.provenance,
          suggestionEvidence: parsed.suggestionEvidence,
          creatorUserId: callerUserId,
          lastActorUserId: callerUserId,
          reviewedAt: null,
          archivedAt: null,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Context Fact already exists.") {
        const pending = await findSuggestedFact(store, {
          subject: parsed.subject,
          category: parsed.category,
          content: parsed.content,
          sensitivity: parsed.sensitivity,
        });
        if (pending) {
          return {
            result: await requireSuggestedReview(pending),
            decision: "existing",
            affectedScopes: [],
          };
        }
      }
      throw error;
    }

    await recordAudit({
      ownerUserId: callerUserId,
      action: "context_fact.suggest",
      fact: created,
      metadataJson: {
        suggestionEvidenceLength: parsed.suggestionEvidence.length,
        sourceRecordId: parsed.provenance.sourceRecordId,
      },
    });

    return {
      result: await requireSuggestedReview(created),
      decision: "created",
      affectedScopes: await affectedScopesForFact(created, callerUserId),
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

  async function listSuggestedContextFactReviews(input: ListContextFactsInput) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    const facts = (
      await store.listContextFacts({
        subjectUserId: callerUserId,
        lifecycle: "suggested",
      })
    )
      .map((fact) => contextFactSchema.parse(fact))
      .filter(hasGroundedEvidence)
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      )
      .slice(0, 6);
    return Promise.all(facts.map((fact) => requireSuggestedReview(fact)));
  }

  async function getSuggestedContextFactReview(input: {
    callerUserId: string;
    contextFactId: string;
  }) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    const fact = await store.getContextFact({
      contextFactId: input.contextFactId,
      subjectUserId: callerUserId,
    });
    if (fact?.subject.kind !== "self" || fact.lifecycle !== "suggested") return null;
    return suggestedReviewForFact(contextFactSchema.parse(fact));
  }

  async function acceptSuggestedContextFact(
    input: AcceptSuggestedContextFactMutationInput,
  ): Promise<ContextFactReviewMutationOutcome> {
    const parsed = acceptSuggestedContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const existing = await store.getContextFact({
      contextFactId: parsed.contextFactId,
      subjectUserId: callerUserId,
    });
    if (existing?.subject.kind !== "self") {
      throw new ContextFactValidationError("That Suggested Context Fact is no longer available.");
    }
    if (existing.lifecycle === "active") {
      return {
        result: toContextFactView(contextFactSchema.parse(existing)),
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
    const match = await findActiveMatch({ ...candidate, excludingId: existing.id });
    if (match) {
      throw conflictError(match);
    }

    const reviewedAt = new Date();
    let updated: ContextFact | null;
    try {
      updated = await store.updateContextFact({
        contextFactId: existing.id,
        subjectUserId: callerUserId,
        lifecycle: "suggested",
        expectedUpdatedAt: parsed.expectedUpdatedAt,
        patch: {
          category: candidate.category,
          content: candidate.content,
          sensitivity: candidate.sensitivity,
          lifecycle: "active",
          reviewedAt,
          archivedAt: null,
          lastActorUserId: callerUserId,
          updatedAt: reviewedAt,
        },
      });
    } catch (error) {
      const concurrentMatch = await findActiveMatch({ ...candidate, excludingId: existing.id });
      if (concurrentMatch) throw conflictError(concurrentMatch);
      throw error;
    }
    if (!updated) {
      const concurrentMatch = await findActiveMatch({ ...candidate, excludingId: existing.id });
      if (concurrentMatch) throw conflictError(concurrentMatch);
      throw new ContextFactValidationError(
        "That suggestion changed elsewhere. Refresh the review and try again.",
      );
    }
    const fact = contextFactSchema.parse(updated);
    const concurrentMatch = await findActiveMatch({ ...candidate, excludingId: fact.id });
    if (concurrentMatch) {
      await store.updateContextFact({
        contextFactId: fact.id,
        subjectUserId: callerUserId,
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
    const existing = await store.getContextFact({
      contextFactId: parsed.contextFactId,
      subjectUserId: callerUserId,
    });
    if (!existing) {
      const dismissedBefore = (await store.listAuditLogEntries({ ownerUserId: callerUserId })).some(
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
    if (existing.subject.kind !== "self" || existing.lifecycle !== "suggested") {
      throw new ContextFactValidationError("That Suggested Context Fact is no longer available.");
    }
    if (parsed.expectedUpdatedAt && !sameInstant(parsed.expectedUpdatedAt, existing.updatedAt)) {
      throw new ContextFactValidationError(
        "That suggestion changed elsewhere. Refresh the review and try again.",
      );
    }

    const fact = contextFactSchema.parse(existing);
    const deleted = await store.deleteContextFact({
      contextFactId: fact.id,
      subjectUserId: callerUserId,
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
