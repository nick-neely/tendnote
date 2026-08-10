import type { RecipientProof } from "@tendnote/domain";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../client";
import { householdMemberships, user } from "../schema";
import { createHouseholdAuthorizationProver } from "./households/authorization";
import { createHouseholdContextActorReader } from "./households/context-actors";
import { createDrizzleHouseholdInvitationStore } from "./households/drizzle-invitation-store";
import { createDrizzleHouseholdStore } from "./households/drizzle-store";
import { createHouseholdGovernanceLifecycle } from "./households/governance";
import { createHouseholdInvitationLifecycle } from "./households/invitations";
import { createHouseholdLifecycle } from "./households/lifecycle";
import {
  createDrizzleHouseholdIdentityStore,
  createHouseholdOverviewReader,
} from "./households/overview";
import type {
  CanViewHouseholdRecordInput,
  CreateHouseholdInput,
  ShareHouseholdRecordInput,
} from "./households/types";

export {
  createHouseholdAuthorizationProver,
  type HouseholdRecordFacts,
} from "./households/authorization";
export { createHouseholdContextActorReader } from "./households/context-actors";
export { createDrizzleHouseholdInvitationStore } from "./households/drizzle-invitation-store";
export { createDrizzleHouseholdStore } from "./households/drizzle-store";
export {
  createHouseholdGovernanceLifecycle,
  type HouseholdDissolutionResult,
  type HouseholdDissolutionState,
} from "./households/governance";
export { createInMemoryHouseholdInvitationStore } from "./households/in-memory-invitation-store";
export { createInMemoryHouseholdStore } from "./households/in-memory-store";
export {
  digestHouseholdInvitationSecret,
  mintHouseholdInvitationSecret,
} from "./households/invitation-secret";
export type * from "./households/invitation-types";
export {
  createHouseholdInvitationLifecycle,
  type SentHouseholdInvitation,
} from "./households/invitations";
export { createHouseholdLifecycle } from "./households/lifecycle";
export {
  createDrizzleHouseholdIdentityStore,
  createHouseholdOverviewReader,
  type HouseholdIdentityStore,
} from "./households/overview";
export type * from "./households/types";

const defaultHouseholdStore = createDrizzleHouseholdStore();
const defaultHouseholdLifecycle = createHouseholdLifecycle(defaultHouseholdStore);
const defaultHouseholdInvitations = createHouseholdInvitationLifecycle(
  createDrizzleHouseholdInvitationStore(),
);
const defaultHouseholdGovernance = createHouseholdGovernanceLifecycle(
  createDrizzleHouseholdInvitationStore(),
);
const defaultHouseholdOverviewReader = createHouseholdOverviewReader(
  defaultHouseholdStore,
  createDrizzleHouseholdIdentityStore(),
  defaultHouseholdInvitations,
);

const defaultHouseholdAuthorizationProver =
  createHouseholdAuthorizationProver(defaultHouseholdStore);

/**
 * The Household Authorization Proof entry points.
 *
 * Every Household-capable operation asks one of these immediately before it
 * reads, reveals, changes, queues, or delivers anything — including deferred and
 * derived work, which proves again at its last safe point rather than trusting
 * the proof that queued it (ADR 0219). They take the caller's id from the
 * session and the record's own stored facts; no argument here can assert
 * membership, audience, or standing.
 */
export function proveHouseholdRecordAccess(
  input: Parameters<typeof defaultHouseholdAuthorizationProver.proveRecordAccess>[0],
) {
  return defaultHouseholdAuthorizationProver.proveRecordAccess(input);
}

/** The proof-or-nothing form: one opaque refusal for every way access can fail. */
export function requireHouseholdRecordAccess(
  input: Parameters<typeof defaultHouseholdAuthorizationProver.requireRecordAccess>[0],
) {
  return defaultHouseholdAuthorizationProver.requireRecordAccess(input);
}

/** Proves a bounded composition and keeps only the records that hold. */
export function proveVisibleHouseholdRecords(
  input: Parameters<typeof defaultHouseholdAuthorizationProver.proveVisibleRecords>[0],
) {
  return defaultHouseholdAuthorizationProver.proveVisibleRecords(input);
}

/** The caller's own Household Overview, or `null` when they have no active household. */
export function getHouseholdOverviewForUser(input: { userId: string }) {
  return defaultHouseholdOverviewReader(input);
}

const defaultHouseholdContextActorReader = createHouseholdContextActorReader(
  defaultHouseholdStore,
  createDrizzleHouseholdIdentityStore(),
);

/**
 * The names Household Context attribution renders, former members included.
 * Empty for a caller with no active household.
 */
export function listHouseholdContextActors(input: { userId: string }) {
  return defaultHouseholdContextActorReader(input);
}

/**
 * The Household Invitation entry points.
 *
 * Every one of them is named for the human action it performs, and none takes a
 * household id: the Owner-side calls resolve the household from the caller's own
 * active owner membership, and the recipient-side calls resolve it from the
 * emailed capability. There is no shape of argument here that describes someone
 * else's household.
 */
export function sendHouseholdInvitation(input: { ownerUserId: string; email: string }) {
  return defaultHouseholdInvitations.sendInvitation(input);
}

export function resendHouseholdInvitation(input: { ownerUserId: string; invitationId: string }) {
  return defaultHouseholdInvitations.resendInvitation(input);
}

export function cancelHouseholdInvitation(input: { ownerUserId: string; invitationId: string }) {
  return defaultHouseholdInvitations.cancelInvitation(input);
}

export function viewHouseholdInvitation(input: {
  secret: string;
  viewer: { userId: string; email: string; activeHouseholds: number } | null;
}) {
  return defaultHouseholdInvitations.viewInvitation(input);
}

export function acceptHouseholdInvitation(proof: RecipientProof) {
  return defaultHouseholdInvitations.acceptInvitation(proof);
}

export function declineHouseholdInvitation(proof: RecipientProof) {
  return defaultHouseholdInvitations.declineInvitation(proof);
}

/**
 * Hands one queued send attempt to the transport, exactly once.
 *
 * The claim lives here rather than in the caller so that "who is allowed to make
 * this external call" is answered by a database row transition, not by whichever
 * request happened to arrive. `send` is the provider adapter; it never sees the
 * invitation record, only what one message needs.
 */
export async function dispatchHouseholdInvitationDelivery(input: {
  deliveryId: string;
  send: () => Promise<{ providerMessageId?: string | null }>;
}) {
  const store = createDrizzleHouseholdInvitationStore();
  const claimed = await store.claimDelivery({ deliveryId: input.deliveryId });
  if (!claimed) return { status: "already-claimed" as const };

  try {
    const result = await input.send();
    await store.completeDelivery({
      deliveryId: claimed.id,
      status: "sent",
      providerMessageId: result.providerMessageId ?? null,
    });
    return { status: "sent" as const };
  } catch (error) {
    // The class, never the provider's payload: an Owner learns there was a
    // delivery problem, not what the provider knows about the recipient.
    await store.completeDelivery({
      deliveryId: claimed.id,
      status: "failed",
      failureClass: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed" as const };
  }
}

export function createHousehold(input: CreateHouseholdInput) {
  return defaultHouseholdLifecycle.createHousehold(input);
}

/**
 * The co-owner governance entry points.
 *
 * Like the invitation entries, none of them takes a household id: each resolves
 * the household through the caller's own active membership, so there is no shape
 * of argument that names someone else's workspace. The rules they enforce —
 * promotion needs the recipient's yes, no Owner may demote or remove another,
 * the last Owner cannot leave, ending is unanimous — are re-decided inside each
 * call against a roster read at that moment (ADR 0213).
 */
export function offerHouseholdOwnerRole(input: { actorUserId: string; memberUserId: string }) {
  return defaultHouseholdGovernance.offerOwnerRole(input);
}

export function withdrawHouseholdOwnerOffer(input: { actorUserId: string; memberUserId: string }) {
  return defaultHouseholdGovernance.withdrawOwnerOffer(input);
}

export function acceptHouseholdOwnerRole(input: { userId: string }) {
  return defaultHouseholdGovernance.acceptOwnerRole(input);
}

export function declineHouseholdOwnerRole(input: { userId: string }) {
  return defaultHouseholdGovernance.declineOwnerRole(input);
}

export function stepDownFromHouseholdOwner(input: { userId: string }) {
  return defaultHouseholdGovernance.stepDownFromOwner(input);
}

export function removeHouseholdMember(input: { actorUserId: string; memberUserId: string }) {
  return defaultHouseholdGovernance.removeMember(input);
}

export function leaveHousehold(input: { userId: string }) {
  return defaultHouseholdGovernance.leaveHousehold(input);
}

export function confirmHouseholdDissolution(input: { ownerUserId: string }) {
  return defaultHouseholdGovernance.confirmDissolution(input);
}

export function cancelHouseholdDissolution(input: { ownerUserId: string }) {
  return defaultHouseholdGovernance.cancelDissolution(input);
}

export function shareHouseholdRecordWithSelectedMembers(input: ShareHouseholdRecordInput) {
  return defaultHouseholdLifecycle.shareRecordWithSelectedMembers(input);
}

export function canViewHouseholdRecord(input: CanViewHouseholdRecordInput) {
  return defaultHouseholdLifecycle.canViewHouseholdRecord(input);
}

export function listActiveHouseholdMembershipsForUser(input: { userId: string }) {
  return defaultHouseholdLifecycle.listActiveMembershipsForUser(input);
}

export async function listShareableHouseholdMembersForUser(input: { userId: string }) {
  const memberships = await defaultHouseholdLifecycle.listActiveMembershipsForUser(input);
  const householdId = memberships[0]?.householdId;
  if (!householdId) {
    return [];
  }

  return getDb()
    .select({
      householdId: householdMemberships.householdId,
      userId: householdMemberships.userId,
      name: user.name,
      email: user.email,
    })
    .from(householdMemberships)
    .innerJoin(user, eq(householdMemberships.userId, user.id))
    .where(
      and(
        eq(householdMemberships.householdId, householdId),
        eq(householdMemberships.status, "active"),
        ne(householdMemberships.userId, input.userId),
      ),
    );
}
