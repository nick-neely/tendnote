import {
  ContextFactValidationError,
  canUseContextFactForOrientation,
  canViewContextFact,
  contextFactSchema,
  contextFactSubjectId,
  createContextFactInputSchema,
  createSelfContextFactInputSchema,
  toContextFactView,
  updateSelfContextFactInputSchema,
} from "@tendnote/domain";
import { affectedScopesForContextFact } from "../affected-scopes";
import type {
  ContextFactMutationOutcome,
  ContextFactQueryDependencies,
  ContextFactStore,
  CreateContextFactMutationInput,
  CreateSelfContextFactMutationInput,
  GetContextFactInput,
  ListContextFactsInput,
  UpdateSelfContextFactMutationInput,
} from "./types";

export function createContextFactQueries(
  store: ContextFactStore,
  dependencies: ContextFactQueryDependencies = {},
) {
  async function activeHouseholdIdsForCaller(callerUserId: string) {
    if (!dependencies.householdAccess) return [];
    const memberships = await dependencies.householdAccess.listActiveHouseholdMembershipsForUser({
      userId: callerUserId,
    });
    return memberships.map((membership) => membership.householdId);
  }

  async function activeHouseholdMemberUserIds(householdId: string) {
    if (!dependencies.householdAccess) return [];
    const memberships = await dependencies.householdAccess.listHouseholdMemberships({
      householdId,
      status: "active",
    });
    return memberships.map((membership) => membership.userId);
  }

  async function requireVerifiedCaller(callerUserId: string) {
    const normalizedCallerUserId = callerUserId.trim();
    if (!normalizedCallerUserId) {
      throw new Error("A verified caller is required.");
    }

    const verifiedCallerUserId = await dependencies.resolveVerifiedCaller?.();
    if (verifiedCallerUserId !== normalizedCallerUserId) {
      throw new Error("A verified caller is required.");
    }

    return normalizedCallerUserId;
  }

  async function assertSubjectBelongsToCaller(input: {
    callerUserId: string;
    subject: CreateContextFactMutationInput["subject"];
  }) {
    if (input.subject.kind === "self") {
      if (input.subject.userId !== input.callerUserId) {
        throw new Error("Self Context can only be created for the caller.");
      }
      return;
    }

    const activeHouseholdIds = await activeHouseholdIdsForCaller(input.callerUserId);
    if (!activeHouseholdIds.includes(input.subject.householdId)) {
      throw new Error("Active household membership is required for Household Context.");
    }
  }

  async function createContextFact(
    input: CreateContextFactMutationInput,
  ): Promise<ContextFactMutationOutcome> {
    const parsed = createContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    await assertSubjectBelongsToCaller({ callerUserId, subject: parsed.subject });
    const now = new Date();
    const fact = contextFactSchema.parse(
      await store.createContextFact({
        subject: parsed.subject,
        category: parsed.category,
        content: parsed.content,
        lifecycle: "active",
        sensitivity: parsed.sensitivity,
        provenance: parsed.provenance,
        suggestionEvidence: null,
        creatorUserId: parsed.callerUserId,
        lastActorUserId: parsed.callerUserId,
        reviewedAt: now,
        archivedAt: null,
      }),
    );

    try {
      await store.createAuditLogEntry({
        ownerUserId: callerUserId,
        action: "context_fact.create",
        entityType: "context_fact",
        entityId: fact.id,
        metadataJson: {
          subjectKind: fact.subject.kind,
          subjectId: contextFactSubjectId(fact.subject),
          category: fact.category,
          lifecycle: fact.lifecycle,
          sensitivity: fact.sensitivity,
          provenanceChannel: fact.provenance.channel,
        },
      });
    } catch {
      // The fact is already committed; audit failure must not lose user context.
    }

    return {
      result: toContextFactView(fact),
      affectedScopes: affectedScopesForContextFact({
        ownerUserId: callerUserId,
        householdId: fact.subject.kind === "household" ? fact.subject.householdId : null,
        householdMemberUserIds:
          fact.subject.kind === "household"
            ? await activeHouseholdMemberUserIds(fact.subject.householdId)
            : undefined,
      }),
    };
  }

  async function updateSelfContextFact(
    input: UpdateSelfContextFactMutationInput,
  ): Promise<ContextFactMutationOutcome> {
    const parsed = updateSelfContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const existing = await store.getContextFact({
      contextFactId: parsed.contextFactId,
      subjectUserId: callerUserId,
    });
    if (existing?.subject.kind !== "self" || existing?.lifecycle !== "active") {
      throw new ContextFactValidationError("That Self Context fact is no longer available.");
    }

    const fact = await store.updateContextFact({
      contextFactId: parsed.contextFactId,
      subjectUserId: callerUserId,
      lifecycle: "active",
      patch: {
        category: parsed.category,
        content: parsed.content,
        sensitivity: parsed.sensitivity,
        lastActorUserId: callerUserId,
        updatedAt: new Date(),
      },
    });
    if (!fact) {
      throw new ContextFactValidationError("That Self Context fact is no longer available.");
    }
    const canonicalFact = contextFactSchema.parse(fact);

    try {
      await store.createAuditLogEntry({
        ownerUserId: callerUserId,
        action: "context_fact.update",
        entityType: "context_fact",
        entityId: canonicalFact.id,
        metadataJson: {
          subjectKind: canonicalFact.subject.kind,
          subjectId: contextFactSubjectId(canonicalFact.subject),
          category: canonicalFact.category,
          lifecycle: canonicalFact.lifecycle,
          sensitivity: canonicalFact.sensitivity,
          provenanceChannel: canonicalFact.provenance.channel,
        },
      });
    } catch {
      // The fact is already committed; audit failure must not lose user context.
    }

    return {
      result: toContextFactView(canonicalFact),
      affectedScopes: affectedScopesForContextFact({ ownerUserId: callerUserId }),
    };
  }

  async function listSelfContextFacts(input: ListContextFactsInput) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    const facts = await store.listContextFacts({
      subjectUserId: callerUserId,
      lifecycle: "active",
    });

    return facts
      .map((fact) => contextFactSchema.parse(fact))
      .filter((fact) =>
        input.includeRestricted === false
          ? canUseContextFactForOrientation({ callerUserId, fact })
          : canViewContextFact({ callerUserId, fact }) && fact.lifecycle === "active",
      )
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      )
      .map(toContextFactView);
  }

  async function listContextFacts(input: ListContextFactsInput) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);

    const activeHouseholdIds = await activeHouseholdIdsForCaller(callerUserId);
    const [selfFacts, householdFacts] = await Promise.all([
      store.listContextFacts({ subjectUserId: callerUserId, lifecycle: "active" }),
      activeHouseholdIds.length > 0
        ? store.listContextFacts({ householdIds: activeHouseholdIds, lifecycle: "active" })
        : Promise.resolve([]),
    ]);

    const facts = [...selfFacts, ...householdFacts]
      .map((fact) => contextFactSchema.parse(fact))
      .filter((fact) =>
        input.includeRestricted === false
          ? canUseContextFactForOrientation({
              callerUserId,
              fact,
              activeHouseholdIds,
            })
          : canViewContextFact({
              callerUserId,
              fact,
              activeHouseholdIds,
            }) && fact.lifecycle === "active",
      )
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      );

    return facts.map(toContextFactView);
  }

  async function getContextFact(input: GetContextFactInput) {
    if (!input.contextFactId.trim()) return null;
    let callerUserId: string;
    try {
      callerUserId = await requireVerifiedCaller(input.callerUserId);
    } catch {
      return null;
    }
    const activeHouseholdIds = await activeHouseholdIdsForCaller(callerUserId);
    const fact = await store.getContextFact({
      contextFactId: input.contextFactId,
      subjectUserId: callerUserId,
      householdIds: activeHouseholdIds,
    });
    if (!fact) return null;
    const parsed = contextFactSchema.parse(fact);
    if (parsed.lifecycle !== "active") return null;
    if (!canViewContextFact({ callerUserId, fact: parsed, activeHouseholdIds })) return null;
    if (
      input.includeRestricted === false &&
      !canUseContextFactForOrientation({ callerUserId, fact: parsed, activeHouseholdIds })
    ) {
      return null;
    }
    return toContextFactView(parsed);
  }

  return {
    createContextFact,
    updateSelfContextFact,
    async createSelfContextFact(input: CreateSelfContextFactMutationInput) {
      const parsed = createSelfContextFactInputSchema.parse(input);
      return createContextFact({
        callerUserId: parsed.callerUserId,
        subject: { kind: "self", userId: parsed.callerUserId },
        category: parsed.category,
        content: parsed.content,
        sensitivity: parsed.sensitivity,
        provenance: parsed.provenance,
      });
    },
    listContextFacts,
    listSelfContextFacts,
    listEligibleContextFacts(input: ListContextFactsInput) {
      return listContextFacts({ ...input, includeRestricted: false });
    },
    getContextFact,
  };
}
