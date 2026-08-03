import {
  archiveContextFactInputSchema,
  archiveSelfContextFactInputSchema,
  buildOrientationContext,
  type ContextFact,
  ContextFactConflictError,
  ContextFactValidationError,
  canViewContextFact,
  contextFactCategoryLabel,
  contextFactSchema,
  contextFactSubjectId,
  createContextFactInputSchema,
  createSelfContextFactInputSchema,
  deleteSelfContextFactInputSchema,
  isContextFactCategoryAllowedForSubject,
  isDuplicateContextFact,
  isLikelyConflictingContextFact,
  normalizeContextFactContent,
  resolveContextFactTransition,
  restoreSelfContextFactInputSchema,
  type SelfContextCategory,
  toContextFactView,
  updateContextFactInputSchema,
  updateSelfContextFactInputSchema,
} from "@tendnote/domain";
import { affectedScopesForContextFact } from "../affected-scopes";
import { createContextFactReviewQueries } from "./review-queries";
import { callerScopedSubjectFilter, sameInstant } from "./shared";
import type {
  ArchiveContextFactMutationInput,
  ContextFactAuditLogInput,
  ContextFactDeleteMutationOutcome,
  ContextFactMutationOutcome,
  ContextFactQueryDependencies,
  ContextFactStore,
  CreateContextFactMutationInput,
  CreateSelfContextFactMutationInput,
  GetContextFactInput,
  GetOrientationContextInput,
  ListContextFactsInput,
  SearchSelfContextFactsInput,
  SelfContextExactResult,
  UpdateContextFactMutationInput,
  UpdateSelfContextFactMutationInput,
} from "./types";

function canReadContextFact(input: {
  callerUserId: string;
  fact: ContextFact;
  activeHouseholdIds?: readonly string[];
  includeRestricted?: boolean;
  includeArchived?: boolean;
}) {
  if (!canViewContextFact(input)) return false;
  if (input.fact.lifecycle === "suggested") return false;
  if (input.fact.lifecycle === "archived" && input.includeArchived !== true) return false;
  return input.includeRestricted !== false || input.fact.sensitivity !== "restricted";
}

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

  async function findActiveMatch(input: {
    subject: ContextFact["subject"];
    callerUserId: string;
    category: ContextFact["category"];
    content: string;
    sensitivity: ContextFact["sensitivity"];
    excludingId?: string;
  }) {
    const activeFacts = await store.listContextFacts({
      ...callerScopedSubjectFilter(input.subject, input.callerUserId),
      lifecycle: "active",
    });
    const candidate = {
      subject: input.subject,
      category: input.category,
      content: input.content,
      sensitivity: input.sensitivity,
    } as const;

    for (const fact of activeFacts.map((value) => contextFactSchema.parse(value))) {
      if (fact.id === input.excludingId) continue;
      if (isDuplicateContextFact({ candidate, existing: fact })) {
        return { kind: "duplicate" as const, fact };
      }
    }

    for (const fact of activeFacts.map((value) => contextFactSchema.parse(value))) {
      if (fact.id === input.excludingId) continue;
      if (isLikelyConflictingContextFact({ candidate, existing: fact })) {
        return { kind: "conflict" as const, fact };
      }
    }

    return null;
  }

  async function affectedScopesForFact(fact: ContextFact, callerUserId: string) {
    return affectedScopesForContextFact({
      ownerUserId: callerUserId,
      householdId: fact.subject.kind === "household" ? fact.subject.householdId : null,
      householdMemberUserIds:
        fact.subject.kind === "household"
          ? await activeHouseholdMemberUserIds(fact.subject.householdId)
          : undefined,
    });
  }

  async function recordAudit(input: {
    ownerUserId: string;
    action: string;
    fact: Pick<
      ContextFact,
      "id" | "subject" | "category" | "lifecycle" | "sensitivity" | "provenance"
    >;
    metadataJson?: Record<string, unknown>;
  }) {
    try {
      await store.createAuditLogEntry(auditLogInput(input));
    } catch {
      // The durable write is authoritative; an audit outage must not lose context.
    }
  }

  function auditLogInput(input: {
    ownerUserId: string;
    action: string;
    fact: Pick<
      ContextFact,
      "id" | "subject" | "category" | "lifecycle" | "sensitivity" | "provenance"
    >;
    metadataJson?: Record<string, unknown>;
  }): ContextFactAuditLogInput {
    return {
      ownerUserId: input.ownerUserId,
      action: input.action,
      entityType: "context_fact",
      entityId: input.fact.id,
      metadataJson: {
        actorUserId: input.ownerUserId,
        subjectKind: input.fact.subject.kind,
        subjectId: contextFactSubjectId(input.fact.subject),
        category: input.fact.category,
        lifecycle: input.fact.lifecycle,
        sensitivity: input.fact.sensitivity,
        provenanceChannel: input.fact.provenance.channel,
        ...input.metadataJson,
      },
    };
  }

  async function mutationOutcome(
    callerUserId: string,
    fact: ContextFact,
    decision: ContextFactMutationOutcome["decision"],
    affectedScopes?: ContextFactMutationOutcome["affectedScopes"],
  ): Promise<ContextFactMutationOutcome> {
    return {
      result: toContextFactView(fact),
      decision,
      affectedScopes: affectedScopes ?? (await affectedScopesForFact(fact, callerUserId)),
    };
  }

  async function existingCreateMatchOutcome(input: {
    callerUserId: string;
    match: Awaited<ReturnType<typeof findActiveMatch>>;
    sourceRecordId: string | null;
  }) {
    if (!input.match) return null;
    if (input.match.kind === "conflict") {
      throw new ContextFactConflictError(
        "A similar active fact already exists. Edit the existing fact instead of creating a conflicting fact.",
        input.match.fact.id,
      );
    }
    if (input.match.fact.provenance.sourceRecordId !== input.sourceRecordId) {
      throw new ContextFactConflictError(
        "An equivalent active fact already has different source evidence. Edit the existing fact instead.",
        input.match.fact.id,
      );
    }
    return mutationOutcome(input.callerUserId, input.match.fact, "existing", []);
  }

  async function createContextFact(
    input: CreateContextFactMutationInput,
  ): Promise<ContextFactMutationOutcome> {
    const parsed = createContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    await assertSubjectBelongsToCaller({ callerUserId, subject: parsed.subject });

    const match = await findActiveMatch({
      subject: parsed.subject,
      callerUserId,
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
    });
    const existingMatch = await existingCreateMatchOutcome({
      callerUserId,
      match,
      sourceRecordId: parsed.provenance.sourceRecordId,
    });
    if (existingMatch) return existingMatch;

    const now = new Date();
    let created: ContextFact;
    try {
      created = contextFactSchema.parse(
        await store.createContextFact({
          subject: parsed.subject,
          category: parsed.category,
          content: parsed.content,
          lifecycle: "active",
          sensitivity: parsed.sensitivity,
          provenance: parsed.provenance,
          suggestionEvidence: null,
          creatorUserId: callerUserId,
          lastActorUserId: callerUserId,
          reviewedAt: now,
          archivedAt: null,
          activeHouseholdMemberUserId: callerUserId,
        }),
      );
    } catch (error) {
      // The database identity index closes the concurrent read-then-create race.
      // Re-read the winner so a concurrent retry remains idempotent and authoritative.
      if (error instanceof Error && error.message === "Context Fact already exists.") {
        const winner = await findActiveMatch({
          subject: parsed.subject,
          callerUserId,
          category: parsed.category,
          content: parsed.content,
          sensitivity: parsed.sensitivity,
        });
        const winnerOutcome = await existingCreateMatchOutcome({
          callerUserId,
          match: winner,
          sourceRecordId: parsed.provenance.sourceRecordId,
        });
        if (winnerOutcome) return winnerOutcome;
      }
      throw error;
    }

    await recordAudit({
      ownerUserId: callerUserId,
      action: "context_fact.create",
      fact: created,
    });

    return mutationOutcome(callerUserId, created, "created");
  }

  type ContextFactMutationSubjectKind = "self" | "household";

  async function accessibleContextFact(input: { callerUserId: string; contextFactId: string }) {
    const activeHouseholdIds = await activeHouseholdIdsForCaller(input.callerUserId);
    const fact = await store.getContextFact({
      contextFactId: input.contextFactId,
      subjectUserId: input.callerUserId,
      householdIds: activeHouseholdIds,
      activeHouseholdMemberUserId: input.callerUserId,
    });
    return fact ? contextFactSchema.parse(fact) : null;
  }

  function mutationUnavailableMessage(expectedSubjectKind?: ContextFactMutationSubjectKind) {
    return expectedSubjectKind === "self"
      ? "That Self Context fact is no longer available."
      : "That Context Fact is no longer available.";
  }

  async function updateContextFactForCaller(
    input: UpdateContextFactMutationInput,
    expectedSubjectKind?: ContextFactMutationSubjectKind,
  ): Promise<ContextFactMutationOutcome> {
    const parsed = updateContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const existing = await accessibleContextFact({
      callerUserId,
      contextFactId: parsed.contextFactId,
    });
    if (
      existing?.lifecycle !== "active" ||
      (expectedSubjectKind !== undefined && existing.subject.kind !== expectedSubjectKind)
    ) {
      throw new ContextFactValidationError(mutationUnavailableMessage(expectedSubjectKind));
    }
    if (
      !isContextFactCategoryAllowedForSubject({
        subject: existing.subject,
        category: parsed.category,
      })
    ) {
      throw new ContextFactValidationError("Composition is only valid for Household Context.");
    }
    if (parsed.expectedUpdatedAt && !sameInstant(parsed.expectedUpdatedAt, existing.updatedAt)) {
      throw new ContextFactValidationError(
        "That fact changed elsewhere. Refresh the page and try again.",
      );
    }

    if (
      existing.category === parsed.category &&
      normalizeContextFactContent(existing.content) ===
        normalizeContextFactContent(parsed.content) &&
      existing.sensitivity === parsed.sensitivity
    ) {
      return mutationOutcome(callerUserId, existing, "existing", []);
    }

    const match = await findActiveMatch({
      subject: existing.subject,
      callerUserId,
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
      excludingId: existing.id,
    });
    if (match) {
      throw new ContextFactConflictError(
        "That correction matches or conflicts with another active fact. Edit the existing fact instead.",
        match.fact.id,
      );
    }

    const fact = await store.updateContextFact({
      ...callerScopedSubjectFilter(existing.subject, callerUserId),
      contextFactId: parsed.contextFactId,
      lifecycle: "active",
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      patch: {
        category: parsed.category,
        content: parsed.content,
        sensitivity: parsed.sensitivity,
        lastActorUserId: callerUserId,
        updatedAt: new Date(),
      },
    });
    if (!fact) {
      throw new ContextFactValidationError(mutationUnavailableMessage(expectedSubjectKind));
    }
    const canonicalFact = contextFactSchema.parse(fact);

    await recordAudit({
      ownerUserId: callerUserId,
      action: "context_fact.update",
      fact: canonicalFact,
      metadataJson: {
        changedFields: ["category", "content", "sensitivity"],
      },
    });

    return mutationOutcome(callerUserId, canonicalFact, "updated");
  }

  async function updateContextFact(input: UpdateContextFactMutationInput) {
    return updateContextFactForCaller(input);
  }

  async function updateHouseholdContextFact(input: UpdateContextFactMutationInput) {
    return updateContextFactForCaller(input, "household");
  }

  async function updateSelfContextFact(
    input: UpdateSelfContextFactMutationInput,
  ): Promise<ContextFactMutationOutcome> {
    const parsed = updateSelfContextFactInputSchema.parse(input);
    return updateContextFactForCaller(parsed, "self");
  }

  async function archiveContextFactForCaller(
    input: ArchiveContextFactMutationInput,
    expectedSubjectKind?: ContextFactMutationSubjectKind,
  ): Promise<ContextFactMutationOutcome> {
    const parsed = archiveContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const existing = await accessibleContextFact({
      callerUserId,
      contextFactId: parsed.contextFactId,
    });
    if (
      !existing ||
      existing.lifecycle === "suggested" ||
      (expectedSubjectKind !== undefined && existing.subject.kind !== expectedSubjectKind)
    ) {
      throw new ContextFactValidationError(mutationUnavailableMessage(expectedSubjectKind));
    }
    if (existing.lifecycle === "archived") {
      return mutationOutcome(callerUserId, existing, "archived", []);
    }
    if (parsed.expectedUpdatedAt && !sameInstant(parsed.expectedUpdatedAt, existing.updatedAt)) {
      throw new ContextFactValidationError(
        "That fact changed elsewhere. Refresh the page and try again.",
      );
    }

    const archivedAt = new Date();
    const updated = await store.updateContextFact({
      ...callerScopedSubjectFilter(existing.subject, callerUserId),
      contextFactId: existing.id,
      lifecycle: "active",
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      patch: {
        lifecycle: resolveContextFactTransition(existing.lifecycle, "archive"),
        archivedAt,
        lastActorUserId: callerUserId,
        updatedAt: archivedAt,
      },
    });
    if (!updated) {
      throw new ContextFactValidationError(mutationUnavailableMessage(expectedSubjectKind));
    }
    const fact = contextFactSchema.parse(updated);
    await recordAudit({
      ownerUserId: callerUserId,
      action: "context_fact.archive",
      fact,
      metadataJson: { previousLifecycle: "active" },
    });
    return mutationOutcome(callerUserId, fact, "archived");
  }

  async function archiveContextFact(input: ArchiveContextFactMutationInput) {
    return archiveContextFactForCaller(input);
  }

  async function archiveHouseholdContextFact(input: ArchiveContextFactMutationInput) {
    return archiveContextFactForCaller(input, "household");
  }

  async function archiveSelfContextFact(input: {
    callerUserId: string;
    contextFactId: string;
    expectedUpdatedAt?: Date;
  }): Promise<ContextFactMutationOutcome> {
    const parsed = archiveSelfContextFactInputSchema.parse(input);
    return archiveContextFactForCaller(parsed, "self");
  }

  async function restoreSelfContextFact(input: {
    callerUserId: string;
    contextFactId: string;
    expectedArchivedAt?: Date;
  }): Promise<ContextFactMutationOutcome> {
    const parsed = restoreSelfContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const existing = await store.getContextFact({
      contextFactId: parsed.contextFactId,
      subjectUserId: callerUserId,
    });
    if (existing?.subject.kind !== "self" || existing.lifecycle === "suggested") {
      throw new ContextFactValidationError("That Self Context fact is no longer available.");
    }
    if (parsed.expectedArchivedAt) {
      if (
        existing.lifecycle !== "archived" ||
        !sameInstant(parsed.expectedArchivedAt, existing.archivedAt)
      ) {
        throw new ContextFactValidationError(
          "That archive changed elsewhere. Refresh the page and try again.",
        );
      }
    }
    if (existing.lifecycle === "active") {
      return mutationOutcome(callerUserId, existing, "restored", []);
    }

    const match = await findActiveMatch({
      subject: existing.subject,
      callerUserId,
      category: existing.category,
      content: existing.content,
      sensitivity: existing.sensitivity,
      excludingId: existing.id,
    });
    if (match?.kind === "duplicate") {
      return mutationOutcome(callerUserId, match.fact, "existing", []);
    }
    if (match?.kind === "conflict") {
      throw new ContextFactConflictError(
        "That fact conflicts with another active fact. Edit the existing fact instead.",
        match.fact.id,
      );
    }

    const updatedAt = new Date();
    const updated = await store.updateContextFact({
      contextFactId: existing.id,
      subjectUserId: callerUserId,
      lifecycle: "archived",
      expectedUpdatedAt: existing.updatedAt,
      expectedArchivedAt: parsed.expectedArchivedAt,
      patch: {
        lifecycle: resolveContextFactTransition(existing.lifecycle, "restore"),
        archivedAt: null,
        lastActorUserId: callerUserId,
        updatedAt,
      },
    });
    if (!updated) {
      throw new ContextFactValidationError("That Self Context fact is no longer available.");
    }
    const fact = contextFactSchema.parse(updated);
    await recordAudit({
      ownerUserId: callerUserId,
      action: "context_fact.restore",
      fact,
      metadataJson: { previousLifecycle: "archived" },
    });
    return mutationOutcome(callerUserId, fact, "restored");
  }

  async function deleteSelfContextFact(input: {
    callerUserId: string;
    contextFactId: string;
  }): Promise<ContextFactDeleteMutationOutcome> {
    const parsed = deleteSelfContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const existing = await store.getContextFact({
      contextFactId: parsed.contextFactId,
      subjectUserId: callerUserId,
    });
    if (!existing) {
      const wasDeleted = (await store.listAuditLogEntries({ ownerUserId: callerUserId })).some(
        (entry) =>
          entry.action === "context_fact.delete" && entry.entityId === parsed.contextFactId,
      );
      if (wasDeleted) {
        return {
          result: { deletedContextFactId: parsed.contextFactId },
          affectedScopes: [],
        };
      }
      throw new ContextFactValidationError("That Self Context fact is no longer available.");
    }
    if (existing.subject.kind !== "self") {
      throw new ContextFactValidationError("That Self Context fact is no longer available.");
    }

    const deleted = await store.deleteContextFact({
      contextFactId: existing.id,
      subjectUserId: callerUserId,
      auditLogEntry: auditLogInput({
        ownerUserId: callerUserId,
        action: "context_fact.delete",
        fact: existing,
        metadataJson: {
          previousLifecycle: existing.lifecycle,
          suggestionEvidenceRemoved: existing.suggestionEvidence !== null,
        },
      }),
    });
    if (!deleted) {
      throw new ContextFactValidationError("That Self Context fact is no longer available.");
    }

    return {
      result: { deletedContextFactId: existing.id },
      affectedScopes: await affectedScopesForFact(existing, callerUserId),
    };
  }

  async function listSelfContextFacts(input: ListContextFactsInput) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    return (await readableSelfContextFacts(callerUserId, input)).map(toContextFactView);
  }

  async function readableSelfContextFacts(
    callerUserId: string,
    input: Pick<ListContextFactsInput, "includeRestricted" | "includeArchived">,
  ) {
    // The owner predicate is pushed into the store read before lifecycle,
    // sensitivity, or lexical matching. No other owner's facts become a
    // candidate whose score or count could be observed by this caller.
    const facts = await store.listContextFacts({
      subjectUserId: callerUserId,
      lifecycles: input.includeArchived ? ["active", "archived"] : ["active"],
    });

    return facts
      .map((fact) => contextFactSchema.parse(fact))
      .filter((fact) => fact.subject.kind === "self" && fact.subject.userId === callerUserId)
      .filter((fact) =>
        canReadContextFact({
          callerUserId,
          fact,
          includeRestricted: input.includeRestricted,
          includeArchived: input.includeArchived,
        }),
      )
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      );
  }

  async function searchSelfContextFacts(
    input: SearchSelfContextFactsInput,
  ): Promise<SelfContextExactResult[]> {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    const tokens = recallQueryTokens(input.query);
    if (tokens.length === 0 || input.limit <= 0) return [];

    const facts = (
      await readableSelfContextFacts(callerUserId, {
        includeArchived: input.includeArchived,
        includeRestricted: input.directlyRequested,
      })
    ).filter(
      (fact): fact is Omit<ContextFact, "category"> & { category: SelfContextCategory } =>
        fact.category !== "composition",
    );

    return facts
      .map((fact) => {
        const fields = [
          { name: "content" as const, value: fact.content },
          { name: "category" as const, value: contextFactCategoryLabel(fact.category) },
        ].map((field) => ({ ...field, value: field.value.toLocaleLowerCase() }));
        const matchedFields = fields
          .filter((field) => tokens.some((token) => field.value.includes(token)))
          .map((field) => field.name);
        const allTokensMatch = tokens.every((token) =>
          fields.some((field) => field.value.includes(token)),
        );
        if (!allTokensMatch) return null;

        const contentMatches = tokens.every((token) => fields[0]?.value.includes(token));
        const categoryMatches = tokens.every((token) => fields[1]?.value.includes(token));
        const rank = (contentMatches ? 4 : 0) + (categoryMatches ? 2 : 0) + matchedFields.length;
        return { fact, matchedFields, rank } satisfies SelfContextExactResult;
      })
      .filter((result): result is SelfContextExactResult => result !== null)
      .sort(
        (left, right) =>
          right.rank - left.rank ||
          right.fact.updatedAt.getTime() - left.fact.updatedAt.getTime() ||
          left.fact.id.localeCompare(right.fact.id),
      )
      .slice(0, input.limit);
  }

  function recallQueryTokens(query: string): string[] {
    return query
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1);
  }

  async function listContextFacts(input: ListContextFactsInput) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);

    const activeHouseholdIds = await activeHouseholdIdsForCaller(callerUserId);
    const lifecycles = input.includeArchived
      ? (["active", "archived"] as const)
      : (["active"] as const);
    const [selfFacts, householdFacts] = await Promise.all([
      store.listContextFacts({ subjectUserId: callerUserId, lifecycles }),
      activeHouseholdIds.length > 0
        ? store.listContextFacts({
            householdIds: activeHouseholdIds,
            activeHouseholdMemberUserId: callerUserId,
            lifecycles,
          })
        : Promise.resolve([]),
    ]);

    const facts = [...selfFacts, ...householdFacts]
      .map((fact) => contextFactSchema.parse(fact))
      .filter((fact) =>
        canReadContextFact({
          callerUserId,
          fact,
          activeHouseholdIds,
          includeRestricted: input.includeRestricted,
          includeArchived: input.includeArchived,
        }),
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
      activeHouseholdMemberUserId: callerUserId,
    });
    if (!fact) return null;
    const parsed = contextFactSchema.parse(fact);
    if (parsed.lifecycle === "suggested") return null;
    if (!input.includeArchived && parsed.lifecycle !== "active") return null;
    if (!canViewContextFact({ callerUserId, fact: parsed, activeHouseholdIds })) return null;
    if (input.includeRestricted === false && parsed.sensitivity === "restricted") {
      return null;
    }
    return toContextFactView(parsed);
  }

  async function getSelfContextFact(input: GetContextFactInput) {
    const fact = await getContextFact(input);
    return fact?.subject.kind === "self" ? fact : null;
  }

  /** Internal owner-scoped read for Capture Change/Undo; never used as a public view. */
  async function getSelfContextFactForCapture(input: GetContextFactInput) {
    if (!input.contextFactId.trim()) return null;
    let callerUserId: string;
    try {
      callerUserId = await requireVerifiedCaller(input.callerUserId);
    } catch {
      return null;
    }
    const fact = await store.getContextFact({
      contextFactId: input.contextFactId,
      subjectUserId: callerUserId,
    });
    if (!fact) return null;
    const parsed = contextFactSchema.parse(fact);
    return parsed.subject.kind === "self" && parsed.lifecycle !== "suggested" ? parsed : null;
  }

  async function getOrientationContext(input: GetOrientationContextInput) {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    const facts = await store.listContextFacts({
      subjectUserId: callerUserId,
      lifecycle: "active",
    });

    return buildOrientationContext({
      callerUserId,
      facts: facts.map((fact) => contextFactSchema.parse(fact)),
      maxBytes: input.maxBytes,
    });
  }

  const reviewQueries = createContextFactReviewQueries({
    store,
    maxPendingSuggestedContextFacts: dependencies.maxPendingSuggestedContextFacts,
    requireVerifiedCaller,
    assertSubjectBelongsToCaller,
    findActiveMatch,
    affectedScopesForFact,
    recordAudit,
    auditLogInput,
  });

  return {
    createContextFact,
    ...reviewQueries,
    updateContextFact,
    updateHouseholdContextFact,
    updateSelfContextFact,
    archiveContextFact,
    archiveHouseholdContextFact,
    archiveSelfContextFact,
    restoreSelfContextFact,
    deleteSelfContextFact,
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
    searchSelfContextFacts,
    listEligibleContextFacts(input: ListContextFactsInput) {
      return listContextFacts({ ...input, includeRestricted: false });
    },
    getContextFact,
    getSelfContextFact,
    getSelfContextFactForCapture,
    getOrientationContext,
  };
}
