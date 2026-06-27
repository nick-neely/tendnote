import type { Followup } from "@tendnote/domain";
import {
  assertConcreteDueAt,
  followupEditSchema,
  resolveFollowupTransition,
} from "@tendnote/domain";
import type {
  AcceptSuggestedFollowupInput,
  EditSuggestedFollowupInput,
  FollowupActionInput,
  FollowupLifecycleStore,
  ListSuggestedFollowupReviewsInput,
  SuggestedFollowupReviewResult,
  SuggestFollowupInput,
} from "./types";

/**
 * Review-gated suggested follow-up lifecycle (PRD #42, ADR-0006). Suggested
 * follow-ups are persisted as `suggested` and stay out of active reminder feeds
 * until explicitly accepted. This reuses the suggested-memory review model
 * (ADR-0027/0028): review items reference persisted follow-up and source-record
 * ids, every mutation is owner-scoped and audited, and accepting promotes through
 * the same shared transition matrix the active lifecycle uses, so the two paths
 * never fork.
 */
export function createSuggestedFollowupReview(store: FollowupLifecycleStore) {
  async function buildReviewResult(
    ownerUserId: string,
    followup: Followup,
  ): Promise<SuggestedFollowupReviewResult> {
    // Source grounding and the person are resolved owner-scoped so review surfaces
    // name the person and show where the suggestion came from (ADR-0028); a record
    // from another owner can never leak in.
    const [sourceRecord, person] = await Promise.all([
      followup.sourceRecordId
        ? store.getSourceRecord({ ownerUserId, sourceRecordId: followup.sourceRecordId })
        : Promise.resolve(null),
      store.getPerson({ ownerUserId, personId: followup.personId }),
    ]);

    return {
      followup,
      person: person ? { id: person.id, displayName: person.displayName } : null,
      sourceRecord,
      component: {
        type: "suggested_followup_review",
        followupId: followup.id,
        sourceRecordId: followup.sourceRecordId ?? null,
      },
    };
  }

  async function requireSuggested(input: FollowupActionInput): Promise<Followup> {
    const followup = await store.getFollowup(input);

    if (!followup) {
      throw new Error("Follow-up not found.");
    }

    if (followup.status !== "suggested") {
      throw new Error("Only suggested follow-ups can be reviewed.");
    }

    return followup;
  }

  return {
    /**
     * Creates a review-gated suggested follow-up: a `suggested` record grounded in
     * an owner-scoped source record, with a concrete due date. It never becomes an
     * active reminder until accepted.
     */
    async suggestFollowup(input: SuggestFollowupInput): Promise<SuggestedFollowupReviewResult> {
      const dueAt = assertConcreteDueAt(input.dueAt);

      const [person, sourceRecord] = await Promise.all([
        store.getPerson({ ownerUserId: input.ownerUserId, personId: input.personId }),
        store.getSourceRecord({
          ownerUserId: input.ownerUserId,
          sourceRecordId: input.sourceRecordId,
        }),
      ]);

      if (!person) {
        throw new Error("Person not found.");
      }

      // Grounding is mandatory: a suggestion must point at a real owner-scoped
      // source record (PRD #42, ADR-0006).
      if (!sourceRecord) {
        throw new Error("A suggested follow-up must be grounded in a source record.");
      }

      const followup = await store.createFollowup({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        reason: input.reason,
        dueAt,
        status: "suggested",
        sourceRecordId: input.sourceRecordId,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "followup.suggest",
        entityType: "followup",
        entityId: followup.id,
        metadataJson: { personId: followup.personId, sourceRecordId: input.sourceRecordId },
      });

      return buildReviewResult(input.ownerUserId, followup);
    },

    async listSuggestedFollowupReviews(
      input: ListSuggestedFollowupReviewsInput,
    ): Promise<SuggestedFollowupReviewResult[]> {
      const suggested = await store.listSuggestedFollowupsForOwner(input);

      return Promise.all(
        suggested.map((followup) => buildReviewResult(input.ownerUserId, followup)),
      );
    },

    async getSuggestedFollowupReview(
      input: FollowupActionInput,
    ): Promise<SuggestedFollowupReviewResult | null> {
      const followup = await store.getFollowup(input);

      if (followup?.status !== "suggested") {
        return null;
      }

      return buildReviewResult(input.ownerUserId, followup);
    },

    /**
     * Accepts a suggested follow-up, promoting it to an active `open` reminder
     * through the shared transition. An optional edit corrects the reason or due
     * date before acceptance.
     */
    async acceptSuggestedFollowup(
      input: AcceptSuggestedFollowupInput,
    ): Promise<SuggestedFollowupReviewResult> {
      const followup = await requireSuggested(input);
      const edit = followupEditSchema.parse(input.edit ?? {});
      const status = resolveFollowupTransition(followup.status, "accept");

      const updated = await store.updateFollowup({
        ownerUserId: input.ownerUserId,
        followupId: followup.id,
        patch: {
          status,
          ...(edit.reason !== undefined ? { reason: edit.reason } : {}),
          ...(edit.dueAt !== undefined ? { dueAt: assertConcreteDueAt(edit.dueAt) } : {}),
        },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "followup.accept",
        entityType: "followup",
        entityId: updated.id,
        metadataJson: {
          personId: updated.personId,
          edited: edit.reason !== undefined || edit.dueAt !== undefined,
        },
      });

      return buildReviewResult(input.ownerUserId, updated);
    },

    /** Corrects a suggested follow-up's reason and/or due date without accepting it. */
    async editSuggestedFollowup(
      input: EditSuggestedFollowupInput,
    ): Promise<SuggestedFollowupReviewResult> {
      const followup = await requireSuggested(input);
      const edit = followupEditSchema.parse(input.edit);

      if (edit.reason === undefined && edit.dueAt === undefined) {
        throw new Error("A follow-up edit must change the reason or the due date.");
      }

      const updated = await store.updateFollowup({
        ownerUserId: input.ownerUserId,
        followupId: followup.id,
        patch: {
          ...(edit.reason !== undefined ? { reason: edit.reason } : {}),
          ...(edit.dueAt !== undefined ? { dueAt: assertConcreteDueAt(edit.dueAt) } : {}),
        },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "followup.review_edit",
        entityType: "followup",
        entityId: updated.id,
        metadataJson: {
          personId: updated.personId,
          editedReason: edit.reason !== undefined,
          editedDueAt: edit.dueAt !== undefined,
        },
      });

      return buildReviewResult(input.ownerUserId, updated);
    },

    /**
     * Dismisses a suggested follow-up so it leaves review and never enters reminder
     * feeds. It is not reintroduced through the normal suggestion path because the
     * review list only returns `suggested` records.
     */
    async dismissSuggestedFollowup(input: FollowupActionInput): Promise<Followup> {
      const followup = await requireSuggested(input);
      const status = resolveFollowupTransition(followup.status, "dismiss");

      const updated = await store.updateFollowup({
        ownerUserId: input.ownerUserId,
        followupId: followup.id,
        patch: { status },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "followup.review_dismiss",
        entityType: "followup",
        entityId: updated.id,
        metadataJson: {
          personId: updated.personId,
          sourceRecordId: updated.sourceRecordId ?? null,
        },
      });

      return updated;
    },
  };
}
