import {
  assertHouseholdAdmissionAvailable,
  assertHouseholdOwner,
  assertHouseholdSeatAvailable,
  decideHouseholdJoin,
  HOUSEHOLD_INVITATION_RESOLVED_VISIBILITY_MS,
  type HouseholdInvitationSummary,
  type HouseholdJoinDecision,
  type HouseholdJoinViewer,
  HouseholdValidationError,
  householdInvitationExpiresAt,
  isHouseholdInvitationLive,
  normalizeInvitationEmail,
  parseInvitationRecipient,
  type RecipientProof,
  resendCooldownRemainingMs,
  summarizeHouseholdInvitation,
} from "@tendnote/domain";
import { createAccessProfileQueries } from "../access-profiles/queries";
import {
  digestHouseholdInvitationSecret,
  type HouseholdInvitationSecret,
  mintHouseholdInvitationSecret,
} from "./invitation-secret";
import type { HouseholdInvitation, HouseholdInvitationStore } from "./invitation-types";

/** What one explicit Owner send produced: the record, the attempt, the one-time link. */
export type SentHouseholdInvitation = {
  invitation: HouseholdInvitationSummary;
  deliveryId: string;
  /** Emailed and then forgotten. Never persisted, logged, or audited. */
  secret: string;
  householdName: string;
  inviterName: string | null;
};

export type HouseholdInvitationLifecycleOptions = {
  now?: () => Date;
  mintSecret?: () => HouseholdInvitationSecret;
};

const LINK_NOT_LIVE = "That invitation is no longer live. Send a new one instead.";

/**
 * The single refusal every recipient-side failure funnels through.
 *
 * Acceptance and decline must not answer differently for "no such link",
 * "already used", "expired", "cancelled", and "not your address" — telling those
 * apart is exactly what a probe holding a guessed link would be trying to do.
 */
function unusableLink(): never {
  throw new HouseholdValidationError(
    "This invitation link can't be used. Ask whoever invited you to send a new one.",
  );
}

/**
 * Persists the lapse of any invitation whose window has passed, and answers with
 * the ones still live.
 *
 * Reads already derive expiry from the clock, so this changes no decision. It
 * exists because the live-recipient unique index is partial on `pending`: a
 * lapsed row left alone would block a fresh invitation to the same address
 * forever.
 */
async function settleLapsedInvitations(
  store: HouseholdInvitationStore,
  input: { householdId: string; at: Date },
): Promise<HouseholdInvitation[]> {
  const pending = await store.listInvitations({ householdId: input.householdId, state: "pending" });
  const live: HouseholdInvitation[] = [];
  for (const invitation of pending) {
    if (isHouseholdInvitationLive(invitation, input.at)) {
      live.push(invitation);
      continue;
    }
    await store.updateInvitation({
      invitationId: invitation.id,
      patch: { state: "expired", resolvedAt: input.at },
    });
  }
  return live;
}

/**
 * The one seat gate. Live invitations count alongside active members (ADR 0213),
 * and every caller takes the household's row lock first, so two concurrent
 * seat-consuming operations cannot both read a household with room left.
 */
async function assertSeatAvailable(
  store: HouseholdInvitationStore,
  input: { householdId: string; at: Date },
) {
  const members = await store.households.listHouseholdMemberships({
    householdId: input.householdId,
    status: "active",
  });
  const live = await settleLapsedInvitations(store, input);
  return assertHouseholdSeatAvailable({
    activeMembers: members.length,
    liveInvitations: live.length,
  });
}

async function activeMemberEmails(
  store: HouseholdInvitationStore,
  input: { householdId: string },
): Promise<Set<string>> {
  const members = await store.households.listHouseholdMemberships({
    householdId: input.householdId,
    status: "active",
  });
  const identities = await store.identities.listUserIdentities({
    userIds: members.map((member) => member.userId),
  });
  return new Set(identities.map((identity) => normalizeInvitationEmail(identity.email)));
}

/**
 * Writes one invitation transition to the audit trail.
 *
 * The metadata is the domain transition and nothing else: no address, no secret,
 * no acceptance URL. Those are the parts of an invitation that must not outlive
 * it in a log the household's records will (research: audit and privacy
 * boundary).
 */
async function recordTransition(
  store: HouseholdInvitationStore,
  input: {
    actorUserId: string;
    action: string;
    invitation: HouseholdInvitation;
    previousState: string;
    extra?: Record<string, unknown>;
  },
) {
  await store.households.createAuditLogEntry({
    ownerUserId: input.actorUserId,
    action: input.action,
    entityType: "household_invitation",
    entityId: input.invitation.id,
    metadataJson: {
      householdId: input.invitation.householdId,
      role: input.invitation.role,
      previousState: input.previousState,
      state: input.invitation.state,
      ...input.extra,
    },
  });
}

async function loadBySecret(store: HouseholdInvitationStore, secret: string) {
  const invitation = await store.getInvitationBySecretDigest({
    secretDigest: digestHouseholdInvitationSecret(secret),
  });
  if (!invitation) return null;
  const household = await store.households.getHouseholdWorkspace({
    householdId: invitation.householdId,
  });
  if (!household) return null;
  return { invitation, household };
}

async function inviterDisplayName(
  store: HouseholdInvitationStore,
  userId: string,
): Promise<string | null> {
  const [identity] = await store.identities.listUserIdentities({ userIds: [userId] });
  return identity?.name?.trim() || null;
}

/** Granting admission is part of acceptance, never a best-effort side effect. */
async function grantHouseholdInvitationAccess(
  store: HouseholdInvitationStore,
  userId: string,
): Promise<void> {
  const accessProfiles = createAccessProfileQueries(store.accessProfiles);
  const profile = await accessProfiles.grantAccess({
    userId,
    source: "household_invitation",
  });
  if (profile.status !== "granted") {
    throw new Error("Household invitation admission could not be persisted.");
  }

  // A hosted beta/manual grant is not authoritative in self-hosted mode. A
  // successful invitation is the explicit new admission proof, so retain it as
  // the profile's source; the configured self-hosted owner remains the one
  // source that must not be reclassified or its singleton ownership can move.
  if (profile.source !== "household_invitation" && profile.source !== "self_hosted_bootstrap") {
    const reclassified = await store.accessProfiles.update({
      userId,
      patch: {
        status: "granted",
        source: "household_invitation",
        grantedAt: new Date(),
      },
    });
    if (reclassified?.status !== "granted" || reclassified.source !== "household_invitation") {
      throw new Error("Household invitation admission could not be persisted.");
    }
  }
}

/**
 * The one place a presented secret becomes a usable invitation.
 *
 * Viewing, accepting, and declining all ask the same question — is this link
 * live, and is this session the address it was sent to — so they all ask it
 * through `decideHouseholdJoin`. Writing the check inline in each would let the
 * three drift, and drift here means one of them answering a question the others
 * refuse to.
 *
 * The mapping from decision to failure is the whole contract: every state short
 * of the address being proven collapses into one indistinguishable refusal, and
 * only the already-in-a-household conflict — reachable only *after* the proof —
 * gets its own error (ADR 0213).
 *
 * ## Mailbox proof and the "verified email" acceptance criterion
 *
 * Issue #379 asks that an invitee "join only after authenticating with the
 * invited verified email". What is enforced here is possession of the emailed
 * secret plus a session whose own address matches the invited one. Better Auth's
 * `emailVerified` is deliberately *not* required, because Tendnote sends no
 * verification email: requiring the flag would make every email/password account
 * permanently unable to accept, and would not add proof that the secret does not
 * already carry — the link went to that mailbox and nowhere else.
 *
 * Revisit this the moment verification email ships: at that point `emailVerified`
 * becomes a cheap second factor against a session created for an address its
 * owner never confirmed, and this is where it belongs.
 */
function requireProvenRecipient(
  found: { invitation: HouseholdInvitation; household: { id: string; name: string } } | null,
  input: {
    proof: RecipientProof;
    /** The joiner's own active memberships, or `[]` for an operation that cannot conflict. */
    activeMemberships: readonly { householdId: string }[];
    at: Date;
  },
): { invitation: HouseholdInvitation; household: { id: string; name: string } } {
  const decision = decideHouseholdJoin({
    invitation: found,
    viewer: {
      userId: input.proof.userId,
      email: input.proof.userEmail,
      activeHouseholds: input.activeMemberships.length,
    },
    now: input.at,
  });

  if (decision.state === "workspace-conflict") {
    assertHouseholdAdmissionAvailable(input.activeMemberships);
  }
  if (decision.state !== "ready" || !found) {
    unusableLink();
  }
  return found;
}

/**
 * The Household Invitation lifecycle: send, resend, cancel, accept, decline.
 *
 * Two shapes recur and are deliberate.
 *
 * The Owner-side entries take no household id. Like the Overview reader, they
 * find the household *through* the caller's own active owner membership, so
 * there is no parameter that could name someone else's workspace and no crafted
 * request that could act on one.
 *
 * The recipient-side entries take only the emailed secret and the session's own
 * identity. They never accept a household or invitation id, so there is nothing
 * to enumerate, and every failure answers with one indistinguishable refusal.
 */
export function createHouseholdInvitationLifecycle(
  store: HouseholdInvitationStore,
  options: HouseholdInvitationLifecycleOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const mintSecret = options.mintSecret ?? mintHouseholdInvitationSecret;

  /**
   * Resolves the household the caller owns, or refuses. Ownership is re-decided
   * here on every entry rather than trusted from the surface that rendered the
   * control.
   */
  async function requireOwnedHousehold(input: { ownerUserId: string }) {
    const memberships = await store.households.listActiveHouseholdMembershipsForUser({
      userId: input.ownerUserId,
    });
    const membership = memberships[0];
    if (!membership) {
      throw new Error("Active household membership required.");
    }
    assertHouseholdOwner(membership);
    return membership;
  }

  return {
    async sendInvitation(input: {
      ownerUserId: string;
      email: string;
    }): Promise<SentHouseholdInvitation> {
      const at = now();
      const recipient = parseInvitationRecipient(input.email);
      const ownerMembership = await requireOwnedHousehold(input);
      const householdId = ownerMembership.householdId;

      return store.withTransaction(async (tx) => {
        const household = await tx.lockHousehold({ householdId });
        if (!household) {
          throw new Error("Household workspace not found.");
        }

        if ((await activeMemberEmails(tx, { householdId })).has(recipient.normalizedEmail)) {
          throw new HouseholdValidationError("That person is already in this household.");
        }

        const live = await settleLapsedInvitations(tx, { householdId, at });
        if (live.some((invitation) => invitation.normalizedEmail === recipient.normalizedEmail)) {
          throw new HouseholdValidationError(
            "There's already a live invitation to that address. Resend or cancel it first.",
          );
        }
        await assertSeatAvailable(tx, { householdId, at });

        const secret = mintSecret();
        const invitation = await tx.createInvitation({
          householdId,
          invitedByUserId: input.ownerUserId,
          role: "member",
          email: recipient.email,
          normalizedEmail: recipient.normalizedEmail,
          secretDigest: secret.digest,
          expiresAt: householdInvitationExpiresAt(at),
          lastSentAt: at,
        });
        const delivery = await tx.createDelivery({ invitationId: invitation.id });

        await recordTransition(tx, {
          actorUserId: input.ownerUserId,
          action: "household.invitation_send",
          invitation,
          previousState: "none",
          extra: { deliveryId: delivery.id },
        });

        return {
          invitation: summarizeHouseholdInvitation(invitation, at),
          deliveryId: delivery.id,
          secret: secret.secret,
          householdName: household.name,
          inviterName: await inviterDisplayName(tx, input.ownerUserId),
        };
      });
    },

    async resendInvitation(input: {
      ownerUserId: string;
      invitationId: string;
    }): Promise<SentHouseholdInvitation> {
      const at = now();
      const ownerMembership = await requireOwnedHousehold(input);
      const householdId = ownerMembership.householdId;

      return store.withTransaction(async (tx) => {
        const household = await tx.lockHousehold({ householdId });
        if (!household) {
          throw new Error("Household workspace not found.");
        }

        const invitation = await tx.getInvitationById({ invitationId: input.invitationId });
        if (!invitation || invitation.householdId !== householdId) {
          throw new Error("Household invitation not found.");
        }
        if (!isHouseholdInvitationLive(invitation, at)) {
          throw new HouseholdValidationError(LINK_NOT_LIVE);
        }
        if (resendCooldownRemainingMs(invitation, at) > 0) {
          throw new HouseholdValidationError(
            "That invitation was just sent. Give it a couple of minutes before sending it again.",
          );
        }

        // A resend is a different message carrying a different secret, so it
        // gets its own attempt id. Only an ambiguous provider failure may reuse
        // one, and that reuse happens at the delivery boundary, not here.
        const secret = mintSecret();
        const rotated = await tx.updateInvitation({
          invitationId: invitation.id,
          patch: {
            secretDigest: secret.digest,
            expiresAt: householdInvitationExpiresAt(at),
            lastSentAt: at,
            resendCount: invitation.resendCount + 1,
          },
        });
        const delivery = await tx.createDelivery({ invitationId: rotated.id });

        await recordTransition(tx, {
          actorUserId: input.ownerUserId,
          action: "household.invitation_resend",
          invitation: rotated,
          previousState: "pending",
          extra: { deliveryId: delivery.id, resendCount: rotated.resendCount },
        });

        return {
          invitation: summarizeHouseholdInvitation(rotated, at),
          deliveryId: delivery.id,
          secret: secret.secret,
          householdName: household.name,
          inviterName: await inviterDisplayName(tx, input.ownerUserId),
        };
      });
    },

    async cancelInvitation(input: {
      ownerUserId: string;
      invitationId: string;
    }): Promise<HouseholdInvitationSummary> {
      const at = now();
      const ownerMembership = await requireOwnedHousehold(input);
      const householdId = ownerMembership.householdId;

      // Cancelling releases a seat, so it takes the same lock every other
      // seat-moving path takes: an accept racing this cancel must see one
      // outcome or the other, never a household that has handed the same seat
      // to both.
      return store.withTransaction(async (tx) => {
        if (!(await tx.lockHousehold({ householdId }))) {
          throw new Error("Household workspace not found.");
        }

        const invitation = await tx.getInvitationById({ invitationId: input.invitationId });
        if (!invitation || invitation.householdId !== householdId) {
          throw new Error("Household invitation not found.");
        }
        if (!isHouseholdInvitationLive(invitation, at)) {
          throw new HouseholdValidationError(LINK_NOT_LIVE);
        }

        // Cancelling sends nothing. It kills the outstanding link and hands the
        // seat back, and the recipient is told only by the link going dead.
        const canceled = await tx.updateInvitation({
          invitationId: invitation.id,
          patch: { state: "canceled", resolvedAt: at },
        });
        await recordTransition(tx, {
          actorUserId: input.ownerUserId,
          action: "household.invitation_cancel",
          invitation: canceled,
          previousState: "pending",
        });

        return summarizeHouseholdInvitation(canceled, at);
      });
    },

    /**
     * The Owner's own neutral view of their invitations: every live one, plus
     * any that reached a terminal state recently.
     *
     * The recently-resolved tail exists because an invitation the Owner sent
     * ends without telling them — a decline, an expiry, and a link that was
     * never opened all look identical if the row simply disappears. Keeping it
     * for {@link HOUSEHOLD_INVITATION_RESOLVED_VISIBILITY_DAYS} turns "did that
     * ever land?" into an answer. It stays neutral: the state is the Owner's own
     * invitation's state, never anything about the recipient's account, and a
     * terminal row holds no seat and offers no action.
     *
     * Accepted invitations are excluded — that outcome is already visible, as a
     * person in the People list.
     */
    async listInvitationsForOwner(input: {
      ownerUserId: string;
    }): Promise<HouseholdInvitationSummary[]> {
      const at = now();
      const memberships = await store.households.listActiveHouseholdMembershipsForUser({
        userId: input.ownerUserId,
      });
      const membership = memberships[0];
      // Invitations are an Owner capability; a Member sees the seat count only.
      if (membership?.role !== "owner") return [];

      const all = await store.listInvitations({ householdId: membership.householdId });
      const visibleFrom = at.getTime() - HOUSEHOLD_INVITATION_RESOLVED_VISIBILITY_MS;
      return all
        .filter((invitation) => {
          if (isHouseholdInvitationLive(invitation, at)) return true;
          if (invitation.state === "accepted") return false;
          // An expired invitation's own deadline is when it ended; every other
          // terminal state records the moment explicitly.
          const endedAt = invitation.resolvedAt ?? invitation.expiresAt;
          return endedAt.getTime() >= visibleFrom;
        })
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .map((invitation) => summarizeHouseholdInvitation(invitation, at));
    },

    /** How many seats this household's live invitations are holding. */
    async countLiveInvitations(input: { householdId: string }): Promise<number> {
      const at = now();
      const pending = await store.listInvitations({
        householdId: input.householdId,
        state: "pending",
      });
      return pending.filter((invitation) => isHouseholdInvitationLive(invitation, at)).length;
    },

    /** What the holder of this link may be shown, and nothing more. */
    async viewInvitation(input: {
      secret: string;
      viewer: HouseholdJoinViewer | null;
    }): Promise<HouseholdJoinDecision> {
      return decideHouseholdJoin({
        invitation: await loadBySecret(store, input.secret),
        viewer: input.viewer,
        now: now(),
      });
    },

    /**
     * Consumes one invitation, creates the active membership, and grants the
     * account access in the same transaction.
     *
     * The proof this requires — a live secret plus a session already signed in
     * as the invited address — is documented in full at
     * {@link requireProvenRecipient}, including why Better Auth's
     * `emailVerified` is not part of it today and when that must change.
     */
    async acceptInvitation(proof: RecipientProof): Promise<{ householdId: string }> {
      const at = now();
      const secretDigest = digestHouseholdInvitationSecret(proof.secret);

      return store.withTransaction(async (tx) => {
        const loaded = await loadBySecret(tx, proof.secret);
        const activeMemberships = await tx.households.listActiveHouseholdMembershipsForUser({
          userId: proof.userId,
        });

        // A committed acceptance is still opaque to a viewer, but the same
        // proven recipient may safely retry the request after a timeout. Do
        // not send an already-accepted row through the public join decision:
        // that decision must keep accepted links indistinguishable from every
        // other dead link for view/decline and for a different recipient.
        const found =
          loaded?.invitation.state === "accepted"
            ? loaded
            : requireProvenRecipient(loaded, { proof, activeMemberships, at });

        if (!(await tx.lockHousehold({ householdId: found.household.id }))) {
          unusableLink();
        }

        // Re-read under the lock. A concurrent accept, cancel, or resend may
        // have consumed or rotated this capability since the lookup above. A
        // different recipient must lose that race; the same recipient may
        // replay the already-committed result idempotently.
        const invitation = await tx.getInvitationById({ invitationId: found.invitation.id });
        if (!invitation || invitation.secretDigest !== secretDigest) {
          unusableLink();
        }

        if (invitation.state === "accepted") {
          if (
            invitation.acceptedByUserId !== proof.userId ||
            normalizeInvitationEmail(proof.userEmail) !== invitation.normalizedEmail
          ) {
            unusableLink();
          }

          const currentActiveMemberships =
            await tx.households.listActiveHouseholdMembershipsForUser({ userId: proof.userId });
          if (
            currentActiveMemberships.some(
              (membership) => membership.householdId !== invitation.householdId,
            )
          ) {
            assertHouseholdAdmissionAvailable(currentActiveMemberships);
          }
          if (
            !currentActiveMemberships.some(
              (membership) => membership.householdId === invitation.householdId,
            )
          ) {
            unusableLink();
          }

          // A successful first acceptance always leaves this grant in the same
          // transaction. Repairing a legacy accepted row that lacks it is
          // idempotent and keeps the persisted admission invariant true.
          await grantHouseholdInvitationAccess(tx, proof.userId);
          return { householdId: invitation.householdId };
        }

        if (!isHouseholdInvitationLive(invitation, at)) {
          unusableLink();
        }

        // The proof above was read before the household lock. A membership in
        // another household may have committed while this request was waiting
        // for that lock, so re-check the one-household rule at the write point
        // rather than letting a stale read turn into a cross-household member.
        assertHouseholdAdmissionAvailable(
          await tx.households.listActiveHouseholdMembershipsForUser({ userId: proof.userId }),
        );
        await assertSeatAvailable(tx, { householdId: invitation.householdId, at });

        // Admission is a durable consequence of the same mailbox proof as the
        // membership. Keep it on the transaction-bound access query seam so a
        // failure in either write rolls the other back in production.
        await grantHouseholdInvitationAccess(tx, proof.userId);

        const existing = await tx.households.getHouseholdMembership({
          householdId: invitation.householdId,
          userId: proof.userId,
        });
        if (existing) {
          // Someone who left or was removed and came back through a fresh
          // invitation reuses their row rather than colliding with its unique index.
          await tx.households.updateHouseholdMembership({
            membershipId: existing.id,
            patch: { status: "active", role: invitation.role, acceptedAt: at, removedAt: null },
          });
        } else {
          await tx.households.createHouseholdMembership({
            householdId: invitation.householdId,
            userId: proof.userId,
            invitedByUserId: invitation.invitedByUserId,
            role: invitation.role,
            status: "active",
            invitedAt: invitation.createdAt,
            acceptedAt: at,
            removedAt: null,
          });
        }

        const accepted = await tx.updateInvitation({
          invitationId: invitation.id,
          patch: { state: "accepted", acceptedByUserId: proof.userId, resolvedAt: at },
        });
        await recordTransition(tx, {
          actorUserId: proof.userId,
          action: "household.invitation_accept",
          invitation: accepted,
          previousState: "pending",
        });

        return { householdId: accepted.householdId };
      });
    },

    async declineInvitation(proof: RecipientProof): Promise<void> {
      const at = now();

      return store.withTransaction(async (tx) => {
        const found = requireProvenRecipient(await loadBySecret(tx, proof.secret), {
          proof,
          // Declining releases a seat rather than taking one, so someone who
          // already has a household may still say no to this one. Passing no
          // memberships is what makes the conflict branch unreachable here.
          activeMemberships: [],
          at,
        });

        if (!(await tx.lockHousehold({ householdId: found.household.id }))) {
          unusableLink();
        }

        const invitation = await tx.getInvitationById({ invitationId: found.invitation.id });
        if (!invitation || !isHouseholdInvitationLive(invitation, at)) {
          unusableLink();
        }

        const declined = await tx.updateInvitation({
          invitationId: invitation.id,
          patch: { state: "declined", resolvedAt: at },
        });
        await recordTransition(tx, {
          actorUserId: proof.userId,
          action: "household.invitation_decline",
          invitation: declined,
          previousState: "pending",
        });
      });
    },
  };
}
