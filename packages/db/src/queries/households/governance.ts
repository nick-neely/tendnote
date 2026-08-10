import {
  assertDepartureAllowed,
  assertDissolutionAllowed,
  assertHouseholdOwner,
  assertMemberRemovalAllowed,
  assertOwnerPromotionAllowed,
  assertOwnerStepDownAllowed,
  HOUSEHOLD_STANDING_ENDED,
  type HouseholdCalendarDisconnectReason,
  type HouseholdDissolutionProgress,
  type HouseholdMembership,
  HouseholdValidationError,
  householdDissolutionProgress,
  householdRecoveryDeadline,
  isHouseholdInvitationLive,
} from "@tendnote/domain";
import type { HouseholdInvitationStore } from "./invitation-types";

export type HouseholdGovernanceOptions = {
  now?: () => Date;
  /**
   * Told when access to a household ends — `userId` for one departure or
   * removal, absent for dissolution.
   *
   * This exists because revoking shares is not always the whole of "your access
   * stops now". A member-owned record whose scope is `shared` requires its
   * *owner's* own active membership before ownership is consulted, so a
   * departing owner is refused their own record until something rewrites its
   * scope. Gift Plans are the first family with that shape (#389): the plan
   * stays with the member who made it and goes private here.
   *
   * It is a hook rather than a call into another query module because
   * governance must not learn which record families exist. It runs after the
   * membership rows have moved and outside their transaction, which is the
   * honest limitation: a failure in between leaves those records unreadable by
   * everyone, their owner included. That is the safe direction to fail and a
   * recoverable one — never a disclosure.
   *
   * Whole-household form. {@link HouseholdGovernanceOptions.onAccessEnded} is
   * the per-member form; both fire for the same endings, independently and in no
   * guaranteed order. Neither may assume the other ran, and a hook that throws
   * is logged and dropped rather than failing an ending that already happened.
   */
  onHouseholdAccessEnded?: (input: { householdId: string; userId?: string }) => Promise<void>;
  /**
   * Called once per member whose household access has just ended, after the
   * transaction that ended it has committed. Dissolution fans this out over
   * every member who was still active, because all of them lost access at once.
   *
   * The documented hook for derived work that outlives a membership. It runs
   * outside the transaction deliberately: the membership rows are what the
   * visibility predicate and the proof read, so access is already gone by the
   * time this is called, and each consumer re-reads current visibility rather
   * than being told what changed. That keeps a slow or failing downstream sweep
   * from holding the household's own governance write open, and keeps its
   * correctness from depending on this hook having run - the worst a missed call
   * leaves behind is a subscription whose next reconcile finds nothing.
   *
   * #385 uses it to drop Saved Item Reminder Schedules the departing member can
   * no longer read. #383 joins it for household-native scheduled work.
   *
   * What it revokes is counted by the hook itself, in whatever trail that family
   * keeps, and deliberately not folded into the governance audit entry: the
   * numbers in that entry are what the *transaction* did, and a count from a
   * best-effort sweep that may not have run at all would make the trail's other
   * figures read as less certain than they are. `canceledActionReminders` in
   * particular means exactly what it says — schedules and pending intents for
   * this household's General Actions and Routines — and nothing else.
   */
  onAccessEnded?: (input: { householdId: string; userId: string }) => Promise<void>;
};

/**
 * What ending a household leaves behind, answered at the moment it ends.
 *
 * The recovery deadline is returned rather than only stored so the surface can
 * tell the person who pressed the button exactly how long they have, from the
 * same computation the sweep will use.
 */
export type HouseholdDissolutionResult = {
  dissolvedAt: Date;
  recoveryDeadlineAt: Date;
  canceledInvitations: number;
  endedMemberships: number;
  /** Designations ended and provider caches cleared, whoever connected them. */
  disconnectedCalendars: number;
};

/**
 * How much of one member's own record set came home, per family.
 *
 * Counts, never ids or content: governance says *that* these things moved and is
 * given no way to read any of it (household privacy evidence). Every ending
 * writes the whole set — a removal, a departure, and a dissolution differ in who
 * decided, never in what the trail is allowed to say about it.
 */
type RevertedRecordCounts = {
  revertedActions: number;
  revertedAssets: number;
  revertedSavedItems: number;
  revertedMemories: number;
  revertedSourceRecords: number;
  revertedFollowups: number;
  clearedResponsibilities: number;
};

/** How far a household is from the unanimous decision, plus whether it has ended. */
export type HouseholdDissolutionState = HouseholdDissolutionProgress & {
  dissolved: HouseholdDissolutionResult | null;
};

/**
 * Co-owner governance and the end of a Household Workspace.
 *
 * Every entry here takes the actor's own user id and nothing that names a
 * household, exactly like the invitation lifecycle: the household is found
 * *through* the caller's own active membership, so no crafted argument can point
 * a governance action at someone else's workspace.
 *
 * The rules themselves are not written here. They live in the domain's
 * governance seam, which is also what the Overview reads to decide whether to
 * render a control, so the sentence beside a disabled button and the sentence
 * raised when it is pressed anyway are the same sentence from the same function.
 * What this module owns is the *transitions*: which rows move, in what order,
 * inside which transaction.
 *
 * Two effects recur and are deliberate.
 *
 * Ending someone's membership is one helper ({@link endMembership}) used by
 * removal, departure, and dissolution alike, because "your access stops now"
 * must not have three implementations that can come to disagree. It revokes both
 * directions of member-owned sharing, kills any invitation that person had
 * outstanding, drops their unanswered promotion offer and their dissolution
 * confirmation — and leaves the membership row itself in place, carrying its
 * role and its dates, because factual historical attribution stays with the
 * household (CONTEXT.md, Household-Native Record).
 *
 * Nothing here deletes a member-owned record. A departure ends access, not
 * ownership: what someone wrote is still theirs, and it leaves with them.
 */
export function createHouseholdGovernanceLifecycle(
  store: HouseholdInvitationStore,
  options: HouseholdGovernanceOptions = {},
) {
  const now = options.now ?? (() => new Date());

  /**
   * Tells the record families that access has ended, once the rows have actually
   * moved.
   *
   * After the transaction commits rather than inside it: a hook writes through
   * its own connection, and running it in the middle would have it acting on a
   * membership change that might still roll back. The ordering it does guarantee
   * is the one that matters — nothing is re-privatized on the strength of a
   * departure that did not happen.
   *
   * Every hook is independent, and that is the whole design rather than a
   * defensive flourish. The transaction has committed; the membership rows are
   * already the authority on who may see what, so nothing that fails here can
   * restore access, and nothing that succeeds here is what made the departure
   * true. Letting one throw would do two wrong things at once: turn a completed,
   * irreversible governance write into an error the caller would reasonably
   * retry, and cancel the sweeps that had not run yet — which is how one record
   * family's outage used to take another family's revocation down with it.
   *
   * So each is called on its own, each failure is logged and swallowed, and none
   * of them may depend on another having run or on running in any order. The
   * cost of that is bounded and known: the worst a missed call leaves behind is
   * derived work whose next reconcile finds nothing.
   */
  async function announcePostCommitHook(hook: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      // The hook's name and the error, never the household or the member: a
      // server log is not the audit trail and has no business naming who left.
      console.warn(
        `Household post-departure hook "${hook}" failed; leaving it to reconcile.`,
        error,
      );
    }
  }

  /**
   * Runs every post-commit hook for one ending.
   *
   * `members` is who lost access — one person for a removal or a departure,
   * everyone who was still active for a dissolution. `departingUserId` names that
   * one person and is deliberately absent for a dissolution rather than derived
   * from the list: the whole-household hook draws a real distinction between "one
   * of you left" and "this ended", and reading it off a list that happened to
   * hold one entry would let an empty list quietly claim the household ended.
   */
  async function announceAccessEnded(input: {
    householdId: string;
    members: ReadonlyArray<{ householdId: string; userId: string }>;
    departingUserId?: string;
  }) {
    const { onHouseholdAccessEnded, onAccessEnded } = options;
    if (onHouseholdAccessEnded) {
      await announcePostCommitHook("household-access-ended", () =>
        onHouseholdAccessEnded({
          householdId: input.householdId,
          ...(input.departingUserId ? { userId: input.departingUserId } : {}),
        }),
      );
    }
    if (onAccessEnded) {
      for (const member of input.members) {
        await announcePostCommitHook("access-ended", () => onAccessEnded(member));
      }
    }
  }

  /**
   * The caller's own active membership, and the whole roster it sits in, read
   * under the household's row lock.
   *
   * The lock is what makes these rules rules. Every protection here — last
   * owner, protected co-owner, unanimity — is a statement about who is active
   * *now*, and a roster read outside the lock is a statement about who was
   * active a moment ago: two co-owners pressing Leave at the same instant would
   * each see the other still governing and both be allowed to go, leaving a
   * household nobody can invite into or end. Taking the same lock every
   * seat-consuming invitation path takes (ADR 0213) orders governance against
   * those too, so a departure cannot interleave with an acceptance.
   *
   * The roster is re-read after the lock rather than before, and the caller's
   * own membership comes back out of it, so nothing decided here rests on a row
   * read before the queue was joined.
   *
   * Losing standing is a curated refusal rather than an unexpected failure. It
   * is the ordinary outcome of a stale screen — the household ended, or someone
   * left, between the render and the press — and the surface has to be able to
   * say so. Left as a bare `Error` it would reach the reader as the generic
   * "try again", which is the one thing they should not do.
   */
  async function requireStanding(
    tx: HouseholdInvitationStore,
    userId: string,
  ): Promise<{
    householdId: string;
    membership: HouseholdMembership;
    roster: HouseholdMembership[];
  }> {
    const [found] = await tx.households.listActiveHouseholdMembershipsForUser({ userId });
    if (!found) {
      throw new HouseholdValidationError(HOUSEHOLD_STANDING_ENDED);
    }
    const householdId = found.householdId;
    if (!(await tx.lockHousehold({ householdId }))) {
      throw new Error("Household workspace not found.");
    }

    const roster = await tx.households.listHouseholdMemberships({ householdId });
    const membership = roster.find(
      (member) => member.userId === userId && member.status === "active",
    );
    if (!membership) {
      // Whoever the caller was when they entered, they are not in this household
      // now — a removal or a dissolution committed while they queued for the lock.
      throw new HouseholdValidationError(HOUSEHOLD_STANDING_ENDED);
    }
    return { householdId, membership, roster };
  }

  /** The same, plus the owner check every Owner-side governance action needs. */
  async function requireOwnerStanding(tx: HouseholdInvitationStore, userId: string) {
    const standing = await requireStanding(tx, userId);
    assertHouseholdOwner(standing.membership);
    return standing;
  }

  function membershipOf(roster: readonly HouseholdMembership[], userId: string) {
    return roster.find((member) => member.userId === userId);
  }

  async function audit(
    tx: HouseholdInvitationStore,
    input: {
      actorUserId: string;
      action: string;
      householdId: string;
      entityType: string;
      entityId: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    // Governance metadata is the transition and the people it moved, never
    // record content, an address, or a capability (household privacy evidence).
    await tx.households.createAuditLogEntry({
      ownerUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadataJson: { householdId: input.householdId, ...input.metadata },
    });
  }

  /** Cancels the live invitations matching `sentBy`, or all of them. */
  async function cancelLiveInvitations(
    tx: HouseholdInvitationStore,
    input: { householdId: string; at: Date; sentBy?: string },
  ): Promise<number> {
    const pending = await tx.listInvitations({
      householdId: input.householdId,
      state: "pending",
    });
    let canceled = 0;
    for (const invitation of pending) {
      if (input.sentBy && invitation.invitedByUserId !== input.sentBy) continue;
      // A lapsed row is settled to `expired` rather than `canceled`, so the
      // record still says what actually happened to it.
      const ended = isHouseholdInvitationLive(invitation, input.at) ? "canceled" : "expired";
      await tx.updateInvitation({
        invitationId: invitation.id,
        patch: { state: ended, resolvedAt: input.at },
      });
      if (ended === "canceled") canceled += 1;
    }
    return canceled;
  }

  /**
   * Ends the Household Calendar Connections riding one member's provider grant,
   * or every one of them when no connector is named.
   *
   * A designation is not a second authorization: it reads through the
   * connector's own Google grant, so when that person stops being a member the
   * household's access to their calendar ends at the same instant, and its
   * cached provider data goes with it (ADR 0217).
   *
   * The Event Plans that referenced those calendars are left entirely alone.
   * They are household-native records, so losing a calendar must not touch the
   * household's planning - and their reference is deliberately *not* emptied:
   * the contract is that such a Plan "shows an unavailable provider reference",
   * which a Plan holding no reference at all cannot do. Keeping the address
   * lets the Plan still say it was about a calendar event, lets the surface
   * render that honestly as unavailable, and lets the reference come back if
   * the same calendar is ever designated again. What must not survive is
   * provider *content*, and that is the cache, which does not.
   *
   * Both effects run inside the caller's transaction, so there is no window in
   * which someone has been removed and the calendar they were carrying is still
   * readable.
   */
  async function endConnectorCalendars(
    tx: HouseholdInvitationStore,
    input: {
      householdId: string;
      connectorUserId?: string;
      reason: HouseholdCalendarDisconnectReason;
      at: Date;
    },
  ): Promise<number> {
    const connections = input.connectorUserId
      ? await tx.calendars.listConnectionsForConnector({
          householdId: input.householdId,
          connectorUserId: input.connectorUserId,
        })
      : await tx.calendars.listConnections({
          householdId: input.householdId,
          status: "connected",
        });
    if (connections.length === 0) return 0;

    return tx.calendars.disconnectConnections({
      connectionIds: connections.map((connection) => connection.id),
      reason: input.reason,
      at: input.at,
    });
  }

  /**
   * Sends one member's own records home and unnames them from the household's.
   *
   * One function used by removal, departure, and dissolution alike, for the same
   * reason {@link endMembership} is: "what someone wrote is still theirs" must
   * not have two implementations that can come to disagree about which families
   * it covers. Dissolution reached this rule by a second, shorter path until the
   * live-validation pass found it had drifted — it was missing the responsibility
   * clear, and both paths had lost families as they were added.
   *
   * Nothing here deletes anything. Every record either goes back to `private`
   * with its owner or stays with the workspace; the only thing that ends is the
   * sharing, and the only thing cleared is a name that was a statement about a
   * current member (ADR 0215).
   */
  async function revertMemberOwnedRecords(
    tx: HouseholdInvitationStore,
    input: { householdId: string; userId: string },
  ): Promise<RevertedRecordCounts> {
    const scope = { householdId: input.householdId, ownerUserId: input.userId };
    // Their own shared and household Actions come back to `private` and go with
    // them. Nothing is transferred and nothing is deleted.
    const actions = await tx.scheduledWork.revertMemberOwnedActionsToPrivate(scope);
    // The same for their own Assets and the details they wrote on any Asset
    // here. The household's own Assets stay with the workspace, keeping this
    // member's creator and actor attribution on everything (ADR 0214).
    const assets = await tx.scheduledWork.revertMemberOwnedAssetsToPrivate(scope);
    // And their own Saved Items, which the spec says return to their private
    // space the moment they leave (`docs/phase-8/household-saved-items.md`).
    const savedItems = await tx.scheduledWork.revertMemberOwnedSavedItemsToPrivate(scope);
    // And the Memories, Source Records, and Follow-Ups they deliberately exposed
    // to the household (#388), minus the grounding the household's own records
    // still stand on.
    const relationship =
      await tx.scheduledWork.revertMemberOwnedRelationshipRecordsToPrivate(scope);
    // A name is a statement about a current member, so it is cleared — and
    // Tendnote picks nobody to replace them (ADR 0215).
    const responsibilities = await tx.scheduledWork.clearResponsibilityHolderForMember({
      householdId: input.householdId,
      userId: input.userId,
    });

    return {
      revertedActions: actions.length,
      revertedAssets: assets.length,
      revertedSavedItems: savedItems.length,
      revertedMemories: relationship.memories.length,
      revertedSourceRecords: relationship.sourceRecords.length,
      revertedFollowups: relationship.followups.length,
      clearedResponsibilities: responsibilities.length,
    };
  }

  /**
   * Ends one membership and everything it was carrying.
   *
   * The order matters only in that all of it happens inside one transaction: a
   * departure that revoked sharing but left the membership active, or the
   * reverse, would be a window in which the household and the person disagree
   * about whether they still live together.
   */
  async function endMembership(
    tx: HouseholdInvitationStore,
    input: { householdId: string; membership: HouseholdMembership; at: Date },
  ) {
    const updated = await tx.households.updateHouseholdMembership({
      membershipId: input.membership.id,
      patch: {
        status: "removed",
        removedAt: input.at,
        // The role is kept. It is what this person *was* here, and the household
        // keeps that fact; `status` is what decides what they may now do.
        pendingRole: null,
        pendingRoleOfferedByUserId: null,
        pendingRoleOfferedAt: null,
      },
    });

    await tx.households.deleteHouseholdRecordSharesForMember({
      householdId: input.householdId,
      userId: input.membership.userId,
    });
    await tx.households.clearHouseholdDissolutionConfirmations({
      householdId: input.householdId,
      userId: input.membership.userId,
    });

    // What someone wrote is still theirs, so every family of their own records
    // comes back to `private` and goes with them.
    const reverted = await revertMemberOwnedRecords(tx, {
      householdId: input.householdId,
      userId: input.membership.userId,
    });
    // Their reminders for the household's Actions and Routines end with their
    // access, so no alert can arrive about a record they can no longer see
    // (ADR 0203). Read after the revert above, so their own records — now
    // private again and back with them — keep the reminders they set on them.
    const canceledActionReminders = await tx.scheduledWork.cancelRemindersForRecords({
      recordIds: await tx.scheduledWork.listHouseholdActionIds({
        householdId: input.householdId,
      }),
      userIds: [input.membership.userId],
      at: input.at,
    });
    // An invitation is an exercise of household authority. Someone who has left
    // no longer holds it, so the links they sent stop working with them.
    const canceledInvitations = await cancelLiveInvitations(tx, {
      householdId: input.householdId,
      at: input.at,
      sentBy: input.membership.userId,
    });
    const disconnectedCalendars = await endConnectorCalendars(tx, {
      householdId: input.householdId,
      connectorUserId: input.membership.userId,
      reason: "connector_departed",
      at: input.at,
    });

    return {
      membership: updated,
      audit: {
        ...reverted,
        canceledInvitations,
        canceledActionReminders,
        disconnectedCalendars,
      },
    };
  }

  return {
    /**
     * Offers co-ownership to an active member. It changes nobody's authority:
     * what it writes is a question, and only the recipient's own acceptance
     * answers it (ADR 0213).
     */
    async offerOwnerRole(input: { actorUserId: string; memberUserId: string }) {
      const at = now();
      return store.withTransaction(async (tx) => {
        const { householdId, roster } = await requireOwnerStanding(tx, input.actorUserId);
        assertOwnerPromotionAllowed({
          roster,
          actorUserId: input.actorUserId,
          memberUserId: input.memberUserId,
        });

        const target = membershipOf(roster, input.memberUserId);
        if (!target) {
          throw new HouseholdValidationError("That person is no longer in this household.");
        }
        const offered = await tx.households.updateHouseholdMembership({
          membershipId: target.id,
          patch: {
            pendingRole: "owner",
            pendingRoleOfferedByUserId: input.actorUserId,
            pendingRoleOfferedAt: at,
          },
        });

        await audit(tx, {
          actorUserId: input.actorUserId,
          action: "household.owner_offer",
          householdId,
          entityType: "household_membership",
          entityId: offered.id,
          metadata: { memberUserId: input.memberUserId, offeredRole: "owner" },
        });
        return offered;
      });
    },

    /** Takes back an unanswered offer. Any active Owner may; owners govern jointly. */
    async withdrawOwnerOffer(input: { actorUserId: string; memberUserId: string }) {
      return store.withTransaction(async (tx) => {
        const { householdId, roster } = await requireOwnerStanding(tx, input.actorUserId);
        const target = membershipOf(roster, input.memberUserId);
        if (target?.status !== "active" || target.pendingRole !== "owner") {
          throw new HouseholdValidationError("There's no outstanding offer to take back.");
        }

        const cleared = await tx.households.updateHouseholdMembership({
          membershipId: target.id,
          patch: {
            pendingRole: null,
            pendingRoleOfferedByUserId: null,
            pendingRoleOfferedAt: null,
          },
        });
        await audit(tx, {
          actorUserId: input.actorUserId,
          action: "household.owner_offer_withdraw",
          householdId,
          entityType: "household_membership",
          entityId: cleared.id,
          metadata: { memberUserId: input.memberUserId },
        });
        return cleared;
      });
    },

    /**
     * The recipient's own acceptance, and the only thing that creates a
     * co-owner. It takes no member id: the answer can only ever be about the
     * caller's own membership.
     */
    async acceptOwnerRole(input: { userId: string }) {
      return store.withTransaction(async (tx) => {
        const { householdId, membership } = await requireStanding(tx, input.userId);
        if (membership.pendingRole !== "owner") {
          throw new HouseholdValidationError("There's no invitation to co-own this household.");
        }

        const promoted = await tx.households.updateHouseholdMembership({
          membershipId: membership.id,
          patch: {
            role: "owner",
            pendingRole: null,
            pendingRoleOfferedByUserId: null,
            pendingRoleOfferedAt: null,
          },
        });
        await audit(tx, {
          actorUserId: input.userId,
          action: "household.owner_offer_accept",
          householdId,
          entityType: "household_membership",
          entityId: promoted.id,
          metadata: {
            offeredByUserId: membership.pendingRoleOfferedByUserId,
            offeredAt: membership.pendingRoleOfferedAt?.toISOString() ?? null,
            role: promoted.role,
          },
        });
        return promoted;
      });
    },

    /** Declining leaves the membership exactly as it was. */
    async declineOwnerRole(input: { userId: string }) {
      return store.withTransaction(async (tx) => {
        const { householdId, membership } = await requireStanding(tx, input.userId);
        if (membership.pendingRole !== "owner") {
          throw new HouseholdValidationError("There's no invitation to co-own this household.");
        }

        const declined = await tx.households.updateHouseholdMembership({
          membershipId: membership.id,
          patch: {
            pendingRole: null,
            pendingRoleOfferedByUserId: null,
            pendingRoleOfferedAt: null,
          },
        });
        await audit(tx, {
          actorUserId: input.userId,
          action: "household.owner_offer_decline",
          householdId,
          entityType: "household_membership",
          entityId: declined.id,
        });
        return declined;
      });
    },

    /**
     * An Owner stepping back to member, which is theirs alone to do — no other
     * Owner can demote them — and only while someone else is still governing.
     */
    async stepDownFromOwner(input: { userId: string }) {
      return store.withTransaction(async (tx) => {
        const { householdId, membership, roster } = await requireStanding(tx, input.userId);
        assertOwnerStepDownAllowed({ roster, userId: input.userId });

        const stepped = await tx.households.updateHouseholdMembership({
          membershipId: membership.id,
          patch: { role: "member" },
        });
        // Governing is what a dissolution confirmation asserts, so stepping down
        // withdraws it rather than leaving a vote behind from a role they left.
        await tx.households.clearHouseholdDissolutionConfirmations({
          householdId,
          userId: input.userId,
        });
        await audit(tx, {
          actorUserId: input.userId,
          action: "household.owner_step_down",
          householdId,
          entityType: "household_membership",
          entityId: stepped.id,
          metadata: { role: stepped.role },
        });
        return stepped;
      });
    },

    /**
     * One Owner removing an ordinary member. The protected-co-owner rule makes
     * this impossible to point at another Owner, whatever the caller sends.
     */
    async removeMember(input: { actorUserId: string; memberUserId: string }) {
      const at = now();
      const removed = await store.withTransaction(async (tx) => {
        const { householdId, roster } = await requireOwnerStanding(tx, input.actorUserId);
        assertMemberRemovalAllowed({
          roster,
          actorUserId: input.actorUserId,
          memberUserId: input.memberUserId,
        });

        const target = membershipOf(roster, input.memberUserId);
        if (!target) {
          throw new HouseholdValidationError("That person is no longer in this household.");
        }
        const ended = await endMembership(tx, { householdId, membership: target, at });

        await audit(tx, {
          actorUserId: input.actorUserId,
          action: "household.member_remove",
          householdId,
          entityType: "household_membership",
          entityId: ended.membership.id,
          metadata: {
            memberUserId: input.memberUserId,
            previousRole: target.role,
            ...ended.audit,
          },
        });
        return ended.membership;
      });

      await announceAccessEnded({
        householdId: removed.householdId,
        members: [{ householdId: removed.householdId, userId: removed.userId }],
        departingUserId: removed.userId,
      });
      return removed;
    },

    /**
     * Voluntary departure. Identical in effect to removal — the difference is
     * who decided — except that the last active Owner is held, because a
     * household with nobody governing it can never be invited into or ended.
     */
    async leaveHousehold(input: { userId: string }) {
      const at = now();
      const departed = await store.withTransaction(async (tx) => {
        const { householdId, membership, roster } = await requireStanding(tx, input.userId);
        assertDepartureAllowed({ roster, userId: input.userId });

        const ended = await endMembership(tx, { householdId, membership, at });
        await audit(tx, {
          actorUserId: input.userId,
          action: "household.member_leave",
          householdId,
          entityType: "household_membership",
          entityId: ended.membership.id,
          metadata: {
            previousRole: membership.role,
            ...ended.audit,
          },
        });
        return ended.membership;
      });

      await announceAccessEnded({
        householdId: departed.householdId,
        members: [{ householdId: departed.householdId, userId: departed.userId }],
        departingUserId: departed.userId,
      });
      return departed;
    },

    /**
     * Records this Owner's confirmation that the household should end, and ends
     * it the moment every active Owner has confirmed.
     *
     * Confirm-then-check-unanimity in one transaction, under the household's row
     * lock that {@link requireStanding} already took, is what makes the last
     * confirmation the one that acts: two owners pressing at the same moment
     * produce one dissolution, not two, and the second one reads the first's
     * agreement rather than an older count.
     */
    async confirmDissolution(input: { ownerUserId: string }): Promise<HouseholdDissolutionState> {
      const at = now();
      let endedHouseholdId: string | null = null;
      let endedMembers: ReadonlyArray<{ householdId: string; userId: string }> = [];
      const state = await store.withTransaction(async (tx) => {
        const { householdId, roster } = await requireOwnerStanding(tx, input.ownerUserId);
        assertDissolutionAllowed({ roster, userId: input.ownerUserId });

        await tx.households.confirmHouseholdDissolution({
          householdId,
          userId: input.ownerUserId,
        });
        const confirmations = await tx.households.listHouseholdDissolutionConfirmations({
          householdId,
        });
        const progress = householdDissolutionProgress({
          roster,
          confirmedOwnerUserIds: confirmations.map((confirmation) => confirmation.userId),
        });

        await audit(tx, {
          actorUserId: input.ownerUserId,
          action: "household.dissolution_confirm",
          householdId,
          entityType: "household",
          entityId: householdId,
          metadata: { required: progress.required, confirmed: progress.confirmed },
        });

        if (!progress.unanimous) {
          return { ...progress, dissolved: null };
        }
        endedHouseholdId = householdId;
        // Everyone who was still active: dissolution ends every membership at
        // once, so every one of them has just lost access.
        endedMembers = roster
          .filter((member) => member.status === "active")
          .map((member) => ({ householdId, userId: member.userId }));
        return {
          ...progress,
          dissolved: await dissolve(tx, {
            householdId,
            roster,
            actorUserId: input.ownerUserId,
            confirmedOwnerUserIds: activeOwnerIds(roster),
            at,
          }),
        };
      });

      if (endedHouseholdId) {
        await announceAccessEnded({
          householdId: endedHouseholdId,
          // No `departingUserId`: this is the whole household's sharing ending
          // at once, not several departures.
          members: endedMembers,
        });
      }
      return state;
    },

    /**
     * Calls the whole thing off. One Owner withdrawing is enough, because an
     * ending that is not agreed by everyone is not agreed.
     */
    async cancelDissolution(input: { ownerUserId: string }): Promise<HouseholdDissolutionState> {
      return store.withTransaction(async (tx) => {
        const { householdId, roster } = await requireOwnerStanding(tx, input.ownerUserId);
        await tx.households.clearHouseholdDissolutionConfirmations({ householdId });
        await audit(tx, {
          actorUserId: input.ownerUserId,
          action: "household.dissolution_cancel",
          householdId,
          entityType: "household",
          entityId: householdId,
        });
        return {
          ...householdDissolutionProgress({ roster, confirmedOwnerUserIds: [] }),
          dissolved: null,
        };
      });
    },
  };

  /** The owners a unanimous decision was made by, recorded as its evidence. */
  function activeOwnerIds(roster: readonly HouseholdMembership[]): string[] {
    return roster
      .filter((member) => member.status === "active" && member.role === "owner")
      .map((member) => member.userId);
  }

  /**
   * The ending itself.
   *
   * Access stops for everyone at once: every live invitation dies, every active
   * membership ends, and every member-owned share in this household is revoked.
   * The workspace row survives, marked `dissolved`, because its household-native
   * records enter a recovery window rather than being deleted at the press — and
   * because a household that ended must stay auditable.
   *
   * Household-native scheduled work is cancelled here, beside the invitations
   * and inside this transaction, now that #383 gives `household_native`
   * ownership a writer. Every member's Reminder Schedules and pending intents
   * for the household's own records go at once — an alert about a household
   * that has ended is the clearest possible way to be wrong — while the records
   * themselves stay, marked by the workspace's `dissolved` status, because they
   * enter the recovery window rather than being deleted at the press. Members'
   * own records revert to `private` in the roster loop below and survive with
   * them, exactly as they would on an individual departure.
   *
   * Household-native Saved Items (#385) add nothing to that sweep, and they are
   * the first chance to test the claim rather than assume it: a workspace-owned
   * record has no `owner_user_id`, the reminder and schedule tables are
   * owner-scoped, and `queries/saved-items.ts` skips reminder reconciliation for
   * precisely that reason - a Reminder Schedule belongs to the member who chose
   * it, so the household writing a note never enrols anybody. What those
   * per-member subscriptions do need is the post-commit
   * {@link HouseholdGovernanceOptions.onAccessEnded} fan-out, not this
   * transaction. A family that stores only content has nothing to cancel here.
   *
   * There is still no purge. `dissolvedAt` opens the recovery window and nothing
   * closes it: no job deletes a dissolved household's records once the deadline
   * passes. That sweep remains the prerequisite for #391 and is deliberately not
   * built here — it is a deletion policy over a record set these issues have
   * only just created, and it needs its own decision about what the minimized
   * audit tombstone keeps. #385 is what makes that record set non-empty: a
   * dissolved household now genuinely holds household-native Saved Items and
   * their household-scoped evidence. Until the sweep exists, no surface may
   * promise that anything is deleted; what passing the deadline changes is that
   * recovery stops being offered.
   */
  async function dissolve(
    tx: HouseholdInvitationStore,
    input: {
      householdId: string;
      roster: readonly HouseholdMembership[];
      actorUserId: string;
      confirmedOwnerUserIds: readonly string[];
      at: Date;
    },
  ): Promise<HouseholdDissolutionResult> {
    const canceledInvitations = await cancelLiveInvitations(tx, {
      householdId: input.householdId,
      at: input.at,
    });

    let endedMemberships = 0;
    const reverted: RevertedRecordCounts = {
      revertedActions: 0,
      revertedAssets: 0,
      revertedSavedItems: 0,
      revertedMemories: 0,
      revertedSourceRecords: 0,
      revertedFollowups: 0,
      clearedResponsibilities: 0,
    };
    for (const member of input.roster) {
      if (member.status !== "active") continue;
      await tx.households.updateHouseholdMembership({
        membershipId: member.id,
        patch: {
          status: "removed",
          removedAt: input.at,
          pendingRole: null,
          pendingRoleOfferedByUserId: null,
          pendingRoleOfferedAt: null,
        },
      });
      // Their own records come home with them, family for family, through the
      // same function a single departure uses. This is every member departing at
      // once, so it must not be a second, shorter version of that rule — what
      // stays behind is exactly what the workspace owns, which is what enters the
      // 30-day recovery set, and a name that pointed at a removed member is not
      // part of it (ADR 0213, ADR 0214, ADR 0215).
      const swept = await revertMemberOwnedRecords(tx, {
        householdId: input.householdId,
        userId: member.userId,
      });
      for (const key of Object.keys(reverted) as Array<keyof RevertedRecordCounts>) {
        reverted[key] += swept[key];
      }
      endedMemberships += 1;
    }

    // Every member's reminders for the household's own Actions and Routines, in
    // one sweep rather than per departing member: this is the whole household's
    // scheduled work ending, not several departures. No `userIds`, so nobody is
    // left holding a queued alert about a household that no longer exists.
    const canceledActionReminders = await tx.scheduledWork.cancelRemindersForRecords({
      recordIds: await tx.scheduledWork.listHouseholdActionIds({
        householdId: input.householdId,
      }),
      at: input.at,
    });

    // Every share at once rather than per departing member: this is the whole
    // household's member-owned sharing ending, not several departures.
    await tx.households.deleteHouseholdRecordSharesForMember({ householdId: input.householdId });
    // Likewise every designated calendar at once, whoever connected it. Nothing
    // provider-derived survives a dissolution, including the caches (ADR 0217).
    const disconnectedCalendars = await endConnectorCalendars(tx, {
      householdId: input.householdId,
      reason: "household_dissolved",
      at: input.at,
    });
    await tx.households.clearHouseholdDissolutionConfirmations({ householdId: input.householdId });

    await tx.households.updateHouseholdWorkspace({
      householdId: input.householdId,
      patch: { status: "dissolved", dissolvedAt: input.at },
    });

    const recoveryDeadlineAt = householdRecoveryDeadline(input.at);
    await audit(tx, {
      actorUserId: input.actorUserId,
      action: "household.dissolve",
      householdId: input.householdId,
      entityType: "household",
      entityId: input.householdId,
      metadata: {
        confirmedOwnerUserIds: [...input.confirmedOwnerUserIds],
        canceledInvitations,
        endedMemberships,
        // The same set a removal and a departure record, summed over everyone
        // who was still active. An ending that says less about itself than a
        // single departure does is the trail being wrong about the larger event.
        ...reverted,
        canceledActionReminders,
        disconnectedCalendars,
        recoveryDeadlineAt: recoveryDeadlineAt.toISOString(),
        // Stated in the trail as well as the UI: there is no path from here back
        // in without support, by design (ADR 0213).
        recovery: "support-only",
      },
    });

    return {
      dissolvedAt: input.at,
      recoveryDeadlineAt,
      canceledInvitations,
      endedMemberships,
      disconnectedCalendars,
    };
  }
}
