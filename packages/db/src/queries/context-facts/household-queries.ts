import {
  archiveHouseholdContextFactInputSchema,
  buildHouseholdContextReconciliation,
  type ContextFact,
  ContextFactConflictError,
  type ContextFactMutationDecision,
  ContextFactValidationError,
  type ContextFactView,
  contextFactCategoryLabel,
  contextFactSchema,
  createHouseholdContextFactInputSchema,
  type HouseholdContextReconciliation,
  isContextFactCategoryAllowedForSubject,
  normalizeContextFactContent,
  resolveContextFactTransition,
  restoreHouseholdContextFactInputSchema,
  toContextFactView,
  updateHouseholdContextFactInputSchema,
} from "@tendnote/domain";
import type { AffectedScope } from "../affected-scopes";
import {
  createHouseholdContextAuthorization,
  householdContextRecordFacts,
} from "./household-authorization";
import { callerScopedSubjectFilter, sameInstant } from "./shared";
import type {
  ArchiveHouseholdContextFactMutationInput,
  ContextFactAuditLogInput,
  ContextFactHouseholdAccess,
  ContextFactReviewMatch,
  ContextFactStore,
  CreateHouseholdContextFactMutationInput,
  HouseholdContextExactResult,
  HouseholdContextMutationOutcome,
  ListHouseholdContextFactsInput,
  RestoreHouseholdContextFactMutationInput,
  SearchHouseholdContextFactsInput,
  UpdateHouseholdContextFactMutationInput,
} from "./types";

/**
 * The one sentence a member sees when the fact they pointed at is not theirs to
 * act on any more.
 *
 * Curated rather than the proof's own opaque refusal because reaching here means
 * the page was a moment out of date, and "reload and look again" is a different
 * instruction from "you may not". Which of the two it was is deliberately not
 * guessed at.
 */
const HOUSEHOLD_CONTEXT_GONE =
  "That fact isn't here any more. Reload the page to see where things stand.";

type AuditFact = Pick<
  ContextFact,
  "id" | "subject" | "category" | "lifecycle" | "sensitivity" | "provenance"
>;

export type HouseholdContextQueryContext = {
  store: ContextFactStore;
  householdAccess?: ContextFactHouseholdAccess;
  requireVerifiedCaller: (callerUserId: string) => Promise<string>;
  activeHouseholdIdsForCaller: (callerUserId: string) => Promise<string[]>;
  findActiveMatch: (input: {
    subject: ContextFact["subject"];
    callerUserId: string;
    category: ContextFact["category"];
    content: string;
    sensitivity: ContextFact["sensitivity"];
    excludingId?: string;
  }) => Promise<ContextFactReviewMatch | null>;
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

/**
 * The next version token for one shared fact.
 *
 * `updatedAt` *is* the fence every household write carries, so it has to advance
 * on every write. Two corrections landing inside the same millisecond would
 * otherwise leave the second author's stale version indistinguishable from a
 * fresh read — and a fence that can silently coincide is the silent
 * last-write-wins this domain exists to prevent. Clamping forward rather than
 * reading the clock costs at most a few milliseconds of drift under a burst of
 * edits to one fact, which is nothing a reader can perceive.
 */
function nextVersion(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

function conflictError(match: ContextFactReviewMatch): ContextFactConflictError {
  return new ContextFactConflictError(
    match.kind === "duplicate"
      ? "Someone here has already written this down. Open that fact to change its wording."
      : "There's already a current fact covering this. Correct that one instead of adding a second answer.",
    match.fact.id,
  );
}

/**
 * Household Context, as every active member shares it.
 *
 * Two decisions shape everything here. Authority is symmetric: the record family
 * is declared `household_native` at the proof seam, so an Owner holds nothing a
 * Member does not and no local role test exists to drift from that (ADR 0219).
 * And a stale write is an *answer*, not a failure: it comes back as a
 * reconciliation carrying the member's own draft beside the current statement,
 * so nothing is discarded and nothing is silently overwritten.
 *
 * There is deliberately no force path. A member who chooses Replace resubmits
 * against the version they were just shown, so a second collision reconciles
 * again rather than winning by having pressed later.
 */
export function createHouseholdContextQueries(context: HouseholdContextQueryContext) {
  const {
    store,
    requireVerifiedCaller,
    activeHouseholdIdsForCaller,
    findActiveMatch,
    affectedScopesForFact,
    recordAudit,
  } = context;

  const authorization = createHouseholdContextAuthorization(context.householdAccess);

  /**
   * The caller's one active Household Workspace, or `null`.
   *
   * There is no household parameter anywhere in this module: the caller's own
   * membership is both the lookup key and the standing, so no argument can point
   * this read at a workspace the caller was never in.
   */
  async function callerHouseholdId(callerUserId: string): Promise<string | null> {
    const [householdId] = await activeHouseholdIdsForCaller(callerUserId);
    return householdId ?? null;
  }

  /**
   * Reads one household fact and re-proves it against facts read now.
   *
   * The store filter is the pre-filter over subject and membership; the proof is
   * the ceiling. A row the filter admitted and the proof refuses comes back as
   * `null`, indistinguishable from a fact that was never there.
   */
  async function provenHouseholdFact(input: {
    callerUserId: string;
    contextFactId: string;
    operation: "view" | "update" | "archive";
    householdId: string;
  }): Promise<ContextFact | null> {
    const row = await store.getContextFact({
      contextFactId: input.contextFactId,
      householdIds: [input.householdId],
      activeHouseholdMemberUserId: input.callerUserId,
    });
    if (!row) return null;
    const fact = contextFactSchema.parse(row);
    if (fact.lifecycle === "suggested") return null;

    const record = householdContextRecordFacts(fact);
    if (!record) return null;
    const proof = await authorization.proveHouseholdContextAccess({
      callerUserId: input.callerUserId,
      operation: input.operation,
      record,
    });
    return proof.authorized ? fact : null;
  }

  async function requireHouseholdFact(input: {
    callerUserId: string;
    contextFactId: string;
    operation: "view" | "update" | "archive";
    householdId: string;
  }): Promise<ContextFact> {
    const fact = await provenHouseholdFact(input);
    if (!fact) throw new ContextFactValidationError(HOUSEHOLD_CONTEXT_GONE);
    return fact;
  }

  async function saved(
    callerUserId: string,
    fact: ContextFact,
    decision: ContextFactMutationDecision,
    affectedScopes?: AffectedScope[],
  ): Promise<HouseholdContextMutationOutcome> {
    return {
      result: { outcome: "saved", fact: toContextFactView(fact), decision },
      affectedScopes: affectedScopes ?? (await affectedScopesForFact(fact, callerUserId)),
    };
  }

  function stale(
    draft: HouseholdContextReconciliation["draft"],
    current: ContextFact,
  ): HouseholdContextMutationOutcome {
    return {
      result: {
        outcome: "stale",
        reconciliation: buildHouseholdContextReconciliation({
          draft,
          current: {
            contextFactId: current.id,
            category: current.category,
            content: current.content,
            sensitivity: current.sensitivity,
            lifecycle: current.lifecycle,
            updatedAt: current.updatedAt,
            lastActorUserId: current.lastActorUserId,
          },
        }),
      },
      // A refused write changed nothing, so nothing downstream needs revalidating.
      affectedScopes: [],
    };
  }

  async function listHouseholdContextFacts(
    input: ListHouseholdContextFactsInput,
  ): Promise<ContextFactView[]> {
    const callerUserId = await requireVerifiedCaller(input.callerUserId);
    const householdId = await callerHouseholdId(callerUserId);
    if (!householdId) return [];

    const rows = await store.listContextFacts({
      householdIds: [householdId],
      activeHouseholdMemberUserId: callerUserId,
      lifecycles: input.includeArchived ? ["active", "archived"] : ["active"],
    });

    const proven = await authorization.proveHouseholdContextFacts({
      callerUserId,
      operation: "view",
      purpose: input.purpose ?? "direct",
      facts: rows.map((row) => contextFactSchema.parse(row)),
    });

    return proven
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      )
      .map(toContextFactView);
  }

  /**
   * Active Household Context as an exact recall result.
   *
   * `directlyRequested` is passed straight to the proof as its purpose, so a
   * restricted household fact is reachable only by a caller who asked for it —
   * the same gate that keeps it out of automatic orientation, not a second copy
   * of the rule written here.
   */
  async function searchHouseholdContextFacts(
    input: SearchHouseholdContextFactsInput,
  ): Promise<HouseholdContextExactResult[]> {
    const tokens = recallQueryTokens(input.query);
    if (tokens.length === 0 || input.limit <= 0) return [];

    const facts = await listHouseholdContextFacts({
      callerUserId: input.callerUserId,
      // Suggested and archived facts stay out of ordinary results.
      includeArchived: false,
      purpose: input.directlyRequested ? "direct" : "ambient",
    });

    return facts
      .flatMap<HouseholdContextExactResult>((fact) => {
        const fields = [
          { name: "content" as const, value: fact.content.toLocaleLowerCase() },
          {
            name: "category" as const,
            value: contextFactCategoryLabel(fact.category).toLocaleLowerCase(),
          },
        ];
        if (!tokens.every((token) => fields.some((field) => field.value.includes(token)))) {
          return [];
        }
        const matchedFields = fields
          .filter((field) => tokens.some((token) => field.value.includes(token)))
          .map((field) => field.name);
        const contentMatches = tokens.every((token) => fields[0]?.value.includes(token));
        const categoryMatches = tokens.every((token) => fields[1]?.value.includes(token));
        return [
          {
            fact,
            matchedFields,
            rank: (contentMatches ? 4 : 0) + (categoryMatches ? 2 : 0) + matchedFields.length,
          },
        ];
      })
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

  async function createHouseholdContextFact(
    input: CreateHouseholdContextFactMutationInput,
  ): Promise<HouseholdContextMutationOutcome> {
    const parsed = createHouseholdContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const householdId = await callerHouseholdId(callerUserId);
    if (!householdId) throw new ContextFactValidationError(HOUSEHOLD_CONTEXT_GONE);

    // Creating is mutation authority over the household's own content, so it is
    // proved as `update` against the fact that is about to exist. There is no
    // record yet to point at, which is exactly why the proof is asked about the
    // household and the ownership form rather than about a row.
    await authorization.requireHouseholdContextAccess({
      callerUserId,
      operation: "update",
      record: {
        id: "pending",
        householdId,
        creatorUserId: callerUserId,
        lifecycle: "active",
        sensitivity: parsed.sensitivity,
      },
    });

    const subject = { kind: "household", householdId } as const;
    if (!isContextFactCategoryAllowedForSubject({ subject, category: parsed.category })) {
      throw new ContextFactValidationError("That category doesn't belong to a household fact.");
    }

    const match = await findActiveMatch({
      subject,
      callerUserId,
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
    });
    if (match) throw conflictError(match);

    const now = new Date();
    const created = contextFactSchema.parse(
      await store.createContextFact({
        subject,
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

    await recordAudit({
      ownerUserId: callerUserId,
      action: "household_context_fact.create",
      fact: created,
    });
    return saved(callerUserId, created, "created");
  }

  async function updateHouseholdContextFact(
    input: UpdateHouseholdContextFactMutationInput,
  ): Promise<HouseholdContextMutationOutcome> {
    const parsed = updateHouseholdContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const householdId = await callerHouseholdId(callerUserId);
    if (!householdId) throw new ContextFactValidationError(HOUSEHOLD_CONTEXT_GONE);

    const existing = await requireHouseholdFact({
      callerUserId,
      contextFactId: parsed.contextFactId,
      operation: "update",
      householdId,
    });
    const draft = {
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
    };

    // The two ways a member's edit can be stale, answered the same way: someone
    // corrected the statement, or someone took it out of what everyone sees.
    if (!sameInstant(parsed.expectedUpdatedAt, existing.updatedAt)) return stale(draft, existing);
    if (existing.lifecycle !== "active") return stale(draft, existing);

    if (
      !isContextFactCategoryAllowedForSubject({
        subject: existing.subject,
        category: parsed.category,
      })
    ) {
      throw new ContextFactValidationError("That category doesn't belong to a household fact.");
    }

    if (
      existing.category === parsed.category &&
      existing.sensitivity === parsed.sensitivity &&
      normalizeContextFactContent(existing.content) === normalizeContextFactContent(parsed.content)
    ) {
      return saved(callerUserId, existing, "existing", []);
    }

    const match = await findActiveMatch({
      subject: existing.subject,
      callerUserId,
      category: parsed.category,
      content: parsed.content,
      sensitivity: parsed.sensitivity,
      excludingId: existing.id,
    });
    if (match) throw conflictError(match);

    const updatedAt = nextVersion(existing.updatedAt);
    const updated = await store.updateContextFact({
      ...callerScopedSubjectFilter(existing.subject, callerUserId),
      contextFactId: existing.id,
      lifecycle: "active",
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      patch: {
        category: parsed.category,
        content: parsed.content,
        sensitivity: parsed.sensitivity,
        lastActorUserId: callerUserId,
        updatedAt,
      },
    });
    // The store's own fence lost the race that the read above won. Re-read the
    // winner so the member still gets a reconciliation rather than a dead end.
    if (!updated) {
      const current = await provenHouseholdFact({
        callerUserId,
        contextFactId: existing.id,
        operation: "update",
        householdId,
      });
      if (!current) throw new ContextFactValidationError(HOUSEHOLD_CONTEXT_GONE);
      return stale(draft, current);
    }

    const fact = contextFactSchema.parse(updated);
    await recordAudit({
      ownerUserId: callerUserId,
      action: "household_context_fact.update",
      fact,
      metadataJson: { changedFields: ["category", "content", "sensitivity"] },
    });
    return saved(callerUserId, fact, "updated");
  }

  async function archiveHouseholdContextFact(
    input: ArchiveHouseholdContextFactMutationInput,
  ): Promise<HouseholdContextMutationOutcome> {
    const parsed = archiveHouseholdContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const householdId = await callerHouseholdId(callerUserId);
    if (!householdId) throw new ContextFactValidationError(HOUSEHOLD_CONTEXT_GONE);

    const existing = await requireHouseholdFact({
      callerUserId,
      contextFactId: parsed.contextFactId,
      operation: "archive",
      householdId,
    });
    // Archiving what is already archived is the state the presser wanted.
    if (existing.lifecycle === "archived") return saved(callerUserId, existing, "archived", []);
    if (!sameInstant(parsed.expectedUpdatedAt, existing.updatedAt)) {
      return stale(
        {
          category: existing.category,
          content: existing.content,
          sensitivity: existing.sensitivity,
        },
        existing,
      );
    }

    const archivedAt = nextVersion(existing.updatedAt);
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
    if (!updated) throw new ContextFactValidationError(HOUSEHOLD_CONTEXT_GONE);

    const fact = contextFactSchema.parse(updated);
    await recordAudit({
      ownerUserId: callerUserId,
      action: "household_context_fact.archive",
      fact,
      metadataJson: { previousLifecycle: "active" },
    });
    return saved(callerUserId, fact, "archived");
  }

  /**
   * Puts an archived household fact back among the current ones.
   *
   * It is fenced like every other write and it re-checks for a conflicting
   * current fact first, because the household may well have written a
   * replacement while this one was archived — and restoring on top of that would
   * create two current answers to the same question.
   */
  async function restoreHouseholdContextFact(
    input: RestoreHouseholdContextFactMutationInput,
  ): Promise<HouseholdContextMutationOutcome> {
    const parsed = restoreHouseholdContextFactInputSchema.parse(input);
    const callerUserId = await requireVerifiedCaller(parsed.callerUserId);
    const householdId = await callerHouseholdId(callerUserId);
    if (!householdId) throw new ContextFactValidationError(HOUSEHOLD_CONTEXT_GONE);

    const existing = await requireHouseholdFact({
      callerUserId,
      contextFactId: parsed.contextFactId,
      operation: "update",
      householdId,
    });
    if (existing.lifecycle === "active") return saved(callerUserId, existing, "restored", []);
    if (!sameInstant(parsed.expectedUpdatedAt, existing.updatedAt)) {
      return stale(
        {
          category: existing.category,
          content: existing.content,
          sensitivity: existing.sensitivity,
        },
        existing,
      );
    }

    const match = await findActiveMatch({
      subject: existing.subject,
      callerUserId,
      category: existing.category,
      content: existing.content,
      sensitivity: existing.sensitivity,
      excludingId: existing.id,
    });
    if (match) throw conflictError(match);

    const updatedAt = nextVersion(existing.updatedAt);
    const updated = await store.updateContextFact({
      ...callerScopedSubjectFilter(existing.subject, callerUserId),
      contextFactId: existing.id,
      lifecycle: "archived",
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      patch: {
        lifecycle: resolveContextFactTransition(existing.lifecycle, "restore"),
        archivedAt: null,
        lastActorUserId: callerUserId,
        updatedAt,
      },
    });
    if (!updated) throw new ContextFactValidationError(HOUSEHOLD_CONTEXT_GONE);

    const fact = contextFactSchema.parse(updated);
    await recordAudit({
      ownerUserId: callerUserId,
      action: "household_context_fact.restore",
      fact,
      metadataJson: { previousLifecycle: "archived" },
    });
    return saved(callerUserId, fact, "restored");
  }

  /**
   * The household's share of an Eve turn's automatic orientation.
   *
   * Proved with `ambient` purpose, which is the whole point: nobody pointed at
   * these facts, so a restricted one is refused here and stays reachable only
   * through a direct request. Returns records rather than views because
   * orientation is assembled from the canonical fact, not from a rendered one.
   */
  async function orientationEligibleHouseholdFacts(callerUserId: string): Promise<ContextFact[]> {
    const householdId = await callerHouseholdId(callerUserId);
    if (!householdId) return [];

    const rows = await store.listContextFacts({
      householdIds: [householdId],
      activeHouseholdMemberUserId: callerUserId,
      lifecycle: "active",
    });
    return authorization.proveHouseholdContextFacts({
      callerUserId,
      operation: "view",
      purpose: "ambient",
      facts: rows.map((row) => contextFactSchema.parse(row)),
    });
  }

  return {
    /** Exposed so Review resolves a shared suggestion through this same proof. */
    proveHouseholdContextFacts: authorization.proveHouseholdContextFacts,
    listHouseholdContextFacts,
    orientationEligibleHouseholdFacts,
    searchHouseholdContextFacts,
    createHouseholdContextFact,
    updateHouseholdContextFact,
    archiveHouseholdContextFact,
    restoreHouseholdContextFact,
  };
}
