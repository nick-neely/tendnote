import type {
  CreateHouseholdMembershipInput,
  CreateHouseholdWorkspaceInput,
  HouseholdMemberStatus,
  HouseholdMembership,
  HouseholdRole,
  HouseholdWorkspace,
} from "@tendnote/domain";
import type { SourceRecordAuditLogEntry } from "../source-records/types";

export type HouseholdAuditLogEntry = SourceRecordAuditLogEntry;

export type VisibilityRecordKind =
  | "memory"
  | "source_record"
  | "followup"
  | "general_action"
  | "saved_item"
  | "asset"
  | "asset_memory"
  | "asset_evidence"
  | "gift_plan"
  /**
   * Household-native, so it never produces a share row - a workspace-owned
   * record has no selected audience to store. It is in this union anyway so the
   * kind the Authorization Proof is asked about is one vocabulary (#387).
   */
  | "household_event_plan";

/** The per-record-kind SQL alias the shared visibility predicate is built against. */
export type VisibilityRecordTableAlias = "m" | "sr" | "f" | "ga" | "si" | "a" | "am" | "ae" | "gp";

export type HouseholdRecordShare = {
  id: string;
  householdId: string;
  recordKind: VisibilityRecordKind;
  recordId: string;
  sharedWithUserId: string;
  sharedByUserId: string;
  createdAt: Date;
};

export type HouseholdDissolutionConfirmation = {
  householdId: string;
  userId: string;
  confirmedAt: Date;
};

export type HouseholdStore = {
  createHouseholdWorkspace: (input: CreateHouseholdWorkspaceInput) => Promise<HouseholdWorkspace>;
  getHouseholdWorkspace: (input: { householdId: string }) => Promise<HouseholdWorkspace | null>;
  getHouseholdWorkspaces: (input: { householdIds: string[] }) => Promise<HouseholdWorkspace[]>;
  updateHouseholdWorkspace: (input: {
    householdId: string;
    patch: Partial<Pick<HouseholdWorkspace, "name" | "status" | "dissolvedAt">>;
  }) => Promise<HouseholdWorkspace>;
  createHouseholdMembership: (
    input: CreateHouseholdMembershipInput,
  ) => Promise<HouseholdMembership>;
  getHouseholdMembership: (input: {
    householdId: string;
    userId: string;
  }) => Promise<HouseholdMembership | null>;
  getHouseholdMembershipById: (input: {
    membershipId: string;
  }) => Promise<HouseholdMembership | null>;
  updateHouseholdMembership: (input: {
    membershipId: string;
    patch: Partial<
      Pick<
        HouseholdMembership,
        | "role"
        | "status"
        | "acceptedAt"
        | "removedAt"
        | "pendingRole"
        | "pendingRoleOfferedByUserId"
        | "pendingRoleOfferedAt"
      >
    >;
  }) => Promise<HouseholdMembership>;
  listHouseholdMemberships: (input: {
    householdId: string;
    status?: HouseholdMemberStatus;
  }) => Promise<HouseholdMembership[]>;
  listActiveHouseholdMembershipsForUser: (input: {
    userId: string;
  }) => Promise<HouseholdMembership[]>;
  createHouseholdRecordShare: (input: {
    householdId: string;
    recordKind: VisibilityRecordKind;
    recordId: string;
    sharedWithUserId: string;
    sharedByUserId: string;
  }) => Promise<HouseholdRecordShare>;
  listHouseholdRecordShares: (input: {
    householdId: string;
    recordKind: VisibilityRecordKind;
    recordId: string;
  }) => Promise<HouseholdRecordShare[]>;
  listHouseholdRecordSharesForRecords: (input: {
    householdIds: string[];
    recordKind: VisibilityRecordKind;
    recordIds: string[];
  }) => Promise<HouseholdRecordShare[]>;
  /**
   * Clears every share for one record. Re-scoping a record narrows or re-selects
   * its audience, so stale shares must be removed for the change to be fail-closed —
   * a member dropped from the selection must lose visibility, never keep it (#180).
   */
  deleteHouseholdRecordShares: (input: {
    householdId: string;
    recordKind: VisibilityRecordKind;
    recordId: string;
  }) => Promise<void>;
  /**
   * Clears every share in this household that involves one person, in either
   * direction — what was shared with them, and what they shared with others.
   *
   * Both directions, because a departure ends both halves of member-owned
   * sharing: the leaver loses what the household showed them, and the household
   * loses what the leaver was showing it. Anything less would leave a departed
   * member's records readable by people they no longer live with. `userId`
   * omitted clears the household's sharing entirely, which is what dissolution
   * needs.
   */
  deleteHouseholdRecordSharesForMember: (input: {
    householdId: string;
    userId?: string;
  }) => Promise<void>;
  listHouseholdDissolutionConfirmations: (input: {
    householdId: string;
  }) => Promise<HouseholdDissolutionConfirmation[]>;
  /** Idempotent: pressing confirm twice is one confirmation, not two. */
  confirmHouseholdDissolution: (input: {
    householdId: string;
    userId: string;
  }) => Promise<HouseholdDissolutionConfirmation>;
  /** `userId` omitted calls the whole decision off. */
  clearHouseholdDissolutionConfirmations: (input: {
    householdId: string;
    userId?: string;
  }) => Promise<void>;
  createAuditLogEntry: (
    auditLogEntry: Omit<HouseholdAuditLogEntry, "id" | "createdAt">,
  ) => Promise<HouseholdAuditLogEntry>;
};

export type CreateHouseholdInput = {
  ownerUserId: string;
  name: string;
  defaultScope?: "private" | "shared" | "household";
};

export type InviteHouseholdMemberInput = {
  ownerUserId: string;
  householdId: string;
  invitedUserId: string;
  role?: Extract<HouseholdRole, "member">;
};

export type AcceptHouseholdInviteInput = {
  userId: string;
  householdId: string;
};

export type RemoveHouseholdMemberInput = {
  ownerUserId: string;
  householdId: string;
  memberUserId: string;
};

export type ShareHouseholdRecordInput = {
  actorUserId: string;
  householdId: string;
  recordKind: VisibilityRecordKind;
  recordId: string;
  selectedUserIds: string[];
};

export type CanViewHouseholdRecordInput = {
  callerUserId: string;
  ownerUserId: string;
  householdId: string | null;
  scope: "private" | "shared" | "household";
  recordKind: VisibilityRecordKind;
  recordId: string;
};
