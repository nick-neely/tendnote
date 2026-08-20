import type { HouseholdInvitationState, HouseholdRole, HouseholdWorkspace } from "@tendnote/domain";
import type { AccessProfileStore } from "../access-profiles/types";
import type { HouseholdCalendarStore } from "./calendar-types";
import type { HouseholdIdentityStore } from "./overview";
import type { HouseholdScheduledWorkStore } from "./scheduled-work";
import type { HouseholdStore } from "./types";

export type HouseholdInvitation = {
  id: string;
  householdId: string;
  invitedByUserId: string | null;
  role: HouseholdRole;
  email: string;
  normalizedEmail: string;
  secretDigest: string;
  state: HouseholdInvitationState;
  expiresAt: Date;
  lastSentAt: Date | null;
  resendCount: number;
  acceptedByUserId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateHouseholdInvitationInput = {
  householdId: string;
  invitedByUserId: string;
  role: HouseholdRole;
  email: string;
  normalizedEmail: string;
  secretDigest: string;
  expiresAt: Date;
  lastSentAt: Date | null;
};

export type HouseholdInvitationDeliveryStatus = "queued" | "sending" | "sent" | "failed";

export type HouseholdInvitationDelivery = {
  id: string;
  invitationId: string;
  status: HouseholdInvitationDeliveryStatus;
  requestedAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  providerMessageId: string | null;
  failureClass: string | null;
};

/**
 * Everything the invitation lifecycle needs, bound to one connection.
 *
 * Invitations and memberships are separate records but one capacity decision
 * (ADR 0213), so counting seats and creating the membership that fills one have
 * to happen against the same transaction. That is why the household store and
 * the identity reader hang off this store rather than being resolved separately:
 * `withTransaction` re-binds all three at once, and there is no way to hold a
 * lock on one and read stale rows through another.
 */
export type HouseholdInvitationStore = {
  households: HouseholdStore;
  /**
   * Access persistence bound to the same connection as memberships and the
   * invitation. Acceptance must not be able to commit these records separately.
   */
  accessProfiles: AccessProfileStore;
  identities: HouseholdIdentityStore;
  /**
   * The scheduled work a departure, removal, or dissolution has to end.
   *
   * It hangs off this store for the same reason the household store does:
   * `withTransaction` rebinds it too, so ending a membership and cancelling the
   * reminders that were queued around it commit together or not at all.
   */
  scheduledWork: HouseholdScheduledWorkStore;
  /**
   * The household's designated calendars, bound to the same connection.
   *
   * It hangs off this store for the same reason the household store does: a
   * departure or a dissolution has to end memberships and end the calendar
   * access those memberships were carrying inside one transaction. A window in
   * which someone has been removed but the calendar riding their grant is still
   * readable by the household is exactly the fail-open ADR 0219 rules out.
   */
  calendars: HouseholdCalendarStore;
  /**
   * Runs `fn` inside one transaction, handing it a store bound to that
   * transaction. Acceptance acquires the recipient lock before the household
   * lock; other seat-moving paths acquire the household lock directly.
   */
  withTransaction: <T>(fn: (store: HouseholdInvitationStore) => Promise<T>) => Promise<T>;
  /**
   * Serializes all acceptance attempts for one account, including attempts for
   * different households. Call this before {@link lockHousehold}; that stable
   * order prevents one account from acquiring two household locks and joining
   * both while the requests interleave.
   */
  lockUser: (input: { userId: string }) => Promise<boolean>;
  /**
   * Takes the household's row lock and returns it. Every seat-consuming path
   * takes this first, so two concurrent sends or accepts on one household are
   * ordered rather than both reading a household with room left.
   */
  lockHousehold: (input: { householdId: string }) => Promise<HouseholdWorkspace | null>;
  createInvitation: (input: CreateHouseholdInvitationInput) => Promise<HouseholdInvitation>;
  getInvitationById: (input: { invitationId: string }) => Promise<HouseholdInvitation | null>;
  getInvitationBySecretDigest: (input: {
    secretDigest: string;
  }) => Promise<HouseholdInvitation | null>;
  listInvitations: (input: {
    householdId: string;
    state?: HouseholdInvitationState;
  }) => Promise<HouseholdInvitation[]>;
  updateInvitation: (input: {
    invitationId: string;
    patch: Partial<
      Pick<
        HouseholdInvitation,
        | "secretDigest"
        | "state"
        | "expiresAt"
        | "lastSentAt"
        | "resendCount"
        | "invitedByUserId"
        | "acceptedByUserId"
        | "resolvedAt"
      >
    >;
  }) => Promise<HouseholdInvitation>;
  createDelivery: (input: { invitationId: string }) => Promise<HouseholdInvitationDelivery>;
  /**
   * Moves one queued attempt to `sending`, or answers `null` if someone else
   * already has it. This claim — not the provider — is what keeps one explicit
   * Owner action from becoming two emails.
   */
  claimDelivery: (input: { deliveryId: string }) => Promise<HouseholdInvitationDelivery | null>;
  completeDelivery: (input: {
    deliveryId: string;
    status: Extract<HouseholdInvitationDeliveryStatus, "sent" | "failed">;
    providerMessageId?: string | null;
    failureClass?: string | null;
  }) => Promise<HouseholdInvitationDelivery>;
};
