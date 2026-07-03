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
