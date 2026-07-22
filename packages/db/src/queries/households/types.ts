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
  | "asset_evidence";

/** The per-record-kind SQL alias the shared visibility predicate is built against. */
export type VisibilityRecordTableAlias = "m" | "sr" | "f" | "ga" | "si" | "a" | "am" | "ae";

export type HouseholdRecordShare = {
  id: string;
  householdId: string;
  recordKind: VisibilityRecordKind;
  recordId: string;
  sharedWithUserId: string;
  sharedByUserId: string;
  createdAt: Date;
};

export type HouseholdStore = {
  createHouseholdWorkspace: (input: CreateHouseholdWorkspaceInput) => Promise<HouseholdWorkspace>;
  getHouseholdWorkspace: (input: { householdId: string }) => Promise<HouseholdWorkspace | null>;
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
    patch: Partial<Pick<HouseholdMembership, "role" | "status" | "acceptedAt" | "removedAt">>;
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
