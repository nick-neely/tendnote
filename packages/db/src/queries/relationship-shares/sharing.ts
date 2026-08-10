import type {
  HouseholdRequestPurpose,
  RelationshipRecordKind,
  SharedRelationshipRecordView,
} from "@tendnote/domain";
import {
  HouseholdRecordUnavailableError,
  RELATIONSHIP_RECORD_NOUN,
  RelationshipShareValidationError,
  requiresRestrictedShareConfirmation,
  restrictedShareConfirmationMessage,
  scopeForVisibilityChoice,
  toSharedRelationshipRecordView,
  visibilityChoiceForScope,
} from "@tendnote/domain";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import { resolveRecordVisibility } from "../households/record-visibility";
import type {
  RelationshipRecordFacts,
  RelationshipShareState,
  RelationshipShareStore,
  ShareRelationshipRecordInput,
} from "./types";

/** The indefinite-article form the shared visibility guard phrases messages with. */
const NOUN_WITH_ARTICLE: Record<RelationshipRecordKind, string> = {
  memory: "a memory",
  source_record: "a note",
  followup: "a follow-up",
};

/** The proof subject, built from the record's own stored facts and nothing else. */
function subjectFacts(record: RelationshipRecordFacts) {
  return {
    kind: record.recordKind,
    id: record.recordId,
    ownerUserId: record.ownerUserId,
    scope: record.scope,
    householdId: record.householdId,
    sensitivity: record.sensitivity,
    lifecycle: record.lifecycle,
  } as const;
}

/**
 * Relationship Shares: an owner deliberately exposing one of their own
 * relationship records to their household, read only.
 *
 * Everything here rests on the Household Authorization Proof rather than a
 * local ownership check, so a record's audience can only be changed by whoever
 * the proof says holds `change_audience` on it, and can only be read by whoever
 * the proof says holds `view` — evaluated fresh against current membership, at
 * the moment of the call (ADR 0219). Sharing does not move ownership and grants
 * no other authority: there is no entry point here that edits, archives,
 * re-links, or re-classifies a record on an audience member's behalf, because
 * a Relationship Share confers exactly one verb (ADR 0218).
 */
export function createRelationshipSharing(store: RelationshipShareStore) {
  const prover = createHouseholdAuthorizationProver(store);

  function fail(message: string) {
    return new RelationshipShareValidationError(message);
  }

  /**
   * Loads the record and proves the caller may re-address it.
   *
   * A missing record and an unauthorized one raise the same opaque error, so a
   * caller cannot use this to learn that a record exists.
   */
  async function requireAudienceAuthority(input: {
    ownerUserId: string;
    recordKind: RelationshipRecordKind;
    recordId: string;
  }): Promise<RelationshipRecordFacts> {
    const record = await store.getRelationshipRecord({
      recordKind: input.recordKind,
      recordId: input.recordId,
    });
    if (!record) {
      throw new HouseholdRecordUnavailableError();
    }
    await prover.requireRecordAccess({
      callerUserId: input.ownerUserId,
      operation: "change_audience",
      record: subjectFacts(record),
    });
    return record;
  }

  /** The current audience of one record, as the owner who wrote it sees it. */
  async function currentAudience(record: RelationshipRecordFacts, ownerUserId: string) {
    if (record.scope !== "shared" || !record.householdId) return [];
    const shares = await store.listHouseholdRecordShares({
      householdId: record.householdId,
      recordKind: record.recordKind,
      recordId: record.recordId,
    });
    return shares
      .filter((share) => share.sharedByUserId === ownerUserId)
      .map((share) => share.sharedWithUserId);
  }

  async function shareState(
    record: RelationshipRecordFacts,
    ownerUserId: string,
  ): Promise<RelationshipShareState> {
    const [selectedUserIds, household] = await Promise.all([
      currentAudience(record, ownerUserId),
      record.householdId
        ? store.getHouseholdWorkspace({ householdId: record.householdId })
        : Promise.resolve(null),
    ]);
    return {
      recordKind: record.recordKind,
      recordId: record.recordId,
      scope: record.scope,
      visibilityChoice: visibilityChoiceForScope(record.scope),
      selectedUserIds,
      sensitivity: record.sensitivity,
      householdName: household?.name ?? null,
    };
  }

  /**
   * Sets who may read one relationship record. The owner's decision, start to
   * finish: choosing an audience, narrowing it, or calling the whole thing off.
   *
   * The household is read from the owner's own active membership rather than
   * taken from the caller, so no argument can share a record into a household
   * the owner does not currently belong to. Old shares are cleared before the
   * new scope is written, so dropping someone from the audience — or going
   * back to private — actually removes their access rather than leaving a
   * stale row that still satisfies the proof (ADR 0153).
   */
  async function shareRelationshipRecord(
    input: ShareRelationshipRecordInput,
  ): Promise<RelationshipShareState> {
    const record = await requireAudienceAuthority(input);
    const requestedScope = scopeForVisibilityChoice(input.visibilityChoice);

    if (!record.shareable && requestedScope !== "private") {
      throw fail(`Review this ${RELATIONSHIP_RECORD_NOUN[record.recordKind]} before sharing it.`);
    }

    // Sharing with yourself is not an audience. Dropping the owner here keeps
    // "specific people" honest: choosing only yourself is choosing nobody.
    const selectedUserIds = (input.selectedUserIds ?? []).filter(
      (userId) => userId !== input.ownerUserId,
    );

    const memberships = await store.listActiveHouseholdMembershipsForUser({
      userId: input.ownerUserId,
    });
    const resolved = await resolveRecordVisibility(
      store,
      {
        ownerUserId: input.ownerUserId,
        scope: requestedScope,
        householdId: memberships[0]?.householdId ?? null,
        selectedUserIds,
      },
      {
        recordNoun: RELATIONSHIP_RECORD_NOUN[record.recordKind],
        recordNounWithArticle: NOUN_WITH_ARTICLE[record.recordKind],
        fail,
      },
    );

    if (
      requiresRestrictedShareConfirmation({
        sensitivity: record.sensitivity,
        scope: resolved.scope,
      }) &&
      input.confirmedRestricted !== true
    ) {
      throw fail(restrictedShareConfirmationMessage(record.recordKind));
    }

    // Both households, because a record can move between them: the one it is
    // leaving must not keep a share that outlives the move.
    const householdsToClear = new Set(
      [record.householdId, resolved.householdId].filter((id): id is string => id !== null),
    );
    for (const householdId of householdsToClear) {
      await store.deleteHouseholdRecordShares({
        householdId,
        recordKind: record.recordKind,
        recordId: record.recordId,
      });
    }

    await store.updateRelationshipRecordVisibility({
      recordKind: record.recordKind,
      recordId: record.recordId,
      ownerUserId: record.ownerUserId,
      scope: resolved.scope,
      householdId: resolved.householdId,
    });

    if (resolved.scope === "shared" && resolved.householdId) {
      for (const sharedWithUserId of selectedUserIds) {
        await store.createHouseholdRecordShare({
          householdId: resolved.householdId,
          recordKind: record.recordKind,
          recordId: record.recordId,
          sharedWithUserId,
          sharedByUserId: input.ownerUserId,
        });
      }
    }

    await store.createAuditLogEntry({
      ownerUserId: input.ownerUserId,
      action: "relationship_record.set_audience",
      entityType: record.recordKind,
      entityId: record.recordId,
      metadataJson: {
        householdId: resolved.householdId,
        previousScope: record.scope,
        scope: resolved.scope,
        selectedUserIds,
        sensitivity: record.sensitivity,
        confirmedRestricted: input.confirmedRestricted === true,
      },
    });

    return shareState(
      { ...record, scope: resolved.scope, householdId: resolved.householdId },
      input.ownerUserId,
    );
  }

  return {
    shareRelationshipRecord,

    /** Returns one record to private. The same path, so it cannot drift from it. */
    async stopSharingRelationshipRecord(input: {
      ownerUserId: string;
      recordKind: RelationshipRecordKind;
      recordId: string;
    }): Promise<RelationshipShareState> {
      return shareRelationshipRecord({ ...input, visibilityChoice: "only_me" });
    },

    /** The owner's current audience for one record, for the sharing control. */
    async getRelationshipShareState(input: {
      ownerUserId: string;
      recordKind: RelationshipRecordKind;
      recordId: string;
    }): Promise<RelationshipShareState> {
      const record = await requireAudienceAuthority(input);
      return shareState(record, input.ownerUserId);
    },

    /**
     * The audiences of many records of one kind, in one read, keyed by record id.
     *
     * Only shares this owner wrote are returned, so a batch call cannot be used
     * to learn who else can see somebody else's records. Records with no
     * selected audience are simply absent.
     */
    async listRelationshipShareAudiences(input: {
      ownerUserId: string;
      recordKind: RelationshipRecordKind;
      recordIds: readonly string[];
    }): Promise<Record<string, string[]>> {
      if (input.recordIds.length === 0) return {};
      const memberships = await store.listActiveHouseholdMembershipsForUser({
        userId: input.ownerUserId,
      });
      if (memberships.length === 0) return {};

      const shares = await store.listHouseholdRecordSharesForRecords({
        householdIds: memberships.map((membership) => membership.householdId),
        recordKind: input.recordKind,
        recordIds: [...input.recordIds],
      });

      const audiences: Record<string, string[]> = {};
      for (const share of shares) {
        if (share.sharedByUserId !== input.ownerUserId) continue;
        audiences[share.recordId] = [...(audiences[share.recordId] ?? []), share.sharedWithUserId];
      }
      return audiences;
    },

    /**
     * One shared record, as its audience is allowed to see it.
     *
     * `null` covers every way this can fail — no such record, no share, a
     * revoked membership, a dissolved household, restricted content reached
     * ambiently — because telling those apart is exactly the protected fact
     * (ADR 0219). What comes back is the recipient envelope, which carries the
     * exposed record and its provenance and structurally cannot carry the
     * owner's Person, evidence, or anything else they did not share.
     */
    async readSharedRelationshipRecord(input: {
      callerUserId: string;
      recordKind: RelationshipRecordKind;
      recordId: string;
      purpose?: HouseholdRequestPurpose;
    }): Promise<SharedRelationshipRecordView | null> {
      const record = await store.getRelationshipRecord({
        recordKind: input.recordKind,
        recordId: input.recordId,
      });
      if (!record) return null;

      const proof = await prover.proveRecordAccess({
        callerUserId: input.callerUserId,
        operation: "view",
        purpose: input.purpose ?? "direct",
        record: subjectFacts(record),
      });
      if (!proof.authorized) return null;

      const [personLabel, sharedByName] = await Promise.all([
        record.personId
          ? store.getPersonDisplayLabel({
              ownerUserId: record.ownerUserId,
              personId: record.personId,
            })
          : Promise.resolve(null),
        store.getMemberDisplayName({ userId: record.ownerUserId }),
      ]);

      return toSharedRelationshipRecordView({
        recordKind: record.recordKind,
        recordId: record.recordId,
        body: record.body,
        personLabel,
        recordedAt: record.recordedAt,
        dueAt: record.dueAt,
        trust: record.trust,
        // A household member always has a name; the fallback exists so a
        // missing one degrades to anonymity rather than to a raw user id.
        sharedByName: sharedByName ?? "a household member",
        audience: record.scope === "household" ? "whole_household" : "selected_members",
        viewerIsOwner: proof.via === "owner",
      });
    },
  };
}
