import type { HouseholdRecordOwnership } from "./household-authorization";
import {
  activeHouseholdMembers,
  activeHouseholdOwners,
  type HouseholdRoster,
} from "./household-governance";

export type AccountDeletionRecordDisposition = "delete" | "preserve_with_operational_key";

export type HouseholdAccountDeletionForeignKeyDisposition =
  | "delete_member_relationship"
  | "delete_member_owned_or_null_household_native"
  | "delete_member_owned_or_reassign_household_native"
  | "null_provenance";

export type HouseholdAccountDeletionForeignKey = {
  table: string;
  column: string;
  disposition: HouseholdAccountDeletionForeignKeyDisposition;
};

/**
 * Every member foreign key on a workspace-owned root, retained child, or
 * Household governance row. This is the migration checklist, not a prose family
 * summary: adding a member reference to one of those models requires adding its
 * account-deletion disposition here too.
 */
export const HOUSEHOLD_ACCOUNT_DELETION_FOREIGN_KEYS = [
  { table: "household_workspaces", column: "owner_user_id", disposition: "null_provenance" },
  {
    table: "household_memberships",
    column: "user_id",
    disposition: "delete_member_relationship",
  },
  {
    table: "household_memberships",
    column: "invited_by_user_id",
    disposition: "null_provenance",
  },
  {
    table: "household_memberships",
    column: "pending_role_offered_by_user_id",
    disposition: "null_provenance",
  },
  {
    table: "household_dissolution_confirmations",
    column: "user_id",
    disposition: "delete_member_relationship",
  },
  {
    table: "household_record_shares",
    column: "shared_with_user_id",
    disposition: "delete_member_relationship",
  },
  {
    table: "household_record_shares",
    column: "shared_by_user_id",
    disposition: "delete_member_relationship",
  },
  {
    table: "household_invitations",
    column: "invited_by_user_id",
    disposition: "null_provenance",
  },
  {
    table: "household_invitations",
    column: "accepted_by_user_id",
    disposition: "null_provenance",
  },
  { table: "audit_log", column: "owner_user_id", disposition: "null_provenance" },
  {
    table: "saved_items",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_null_household_native",
  },
  { table: "saved_items", column: "created_by_user_id", disposition: "null_provenance" },
  { table: "saved_items", column: "last_actor_user_id", disposition: "null_provenance" },
  {
    table: "saved_item_events",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_null_household_native",
  },
  { table: "saved_item_events", column: "actor_user_id", disposition: "null_provenance" },
  {
    table: "general_actions",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_reassign_household_native",
  },
  {
    table: "general_actions",
    column: "responsibility_holder_user_id",
    disposition: "null_provenance",
  },
  { table: "general_actions", column: "created_by_user_id", disposition: "null_provenance" },
  { table: "general_actions", column: "last_actor_user_id", disposition: "null_provenance" },
  {
    table: "general_action_events",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_reassign_household_native",
  },
  { table: "general_action_events", column: "actor_user_id", disposition: "null_provenance" },
  {
    table: "general_action_offer_declines",
    column: "user_id",
    disposition: "delete_member_relationship",
  },
  {
    table: "assets",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_reassign_household_native",
  },
  { table: "assets", column: "created_by_user_id", disposition: "null_provenance" },
  { table: "assets", column: "last_actor_user_id", disposition: "null_provenance" },
  {
    table: "asset_audit_events",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_reassign_household_native",
  },
  { table: "asset_audit_events", column: "actor_user_id", disposition: "null_provenance" },
  {
    table: "asset_memories",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_reassign_household_native",
  },
  { table: "asset_memories", column: "created_by_user_id", disposition: "null_provenance" },
  { table: "asset_memories", column: "last_actor_user_id", disposition: "null_provenance" },
  {
    table: "asset_evidence",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_reassign_household_native",
  },
  { table: "asset_evidence", column: "created_by_user_id", disposition: "null_provenance" },
  { table: "asset_evidence", column: "last_actor_user_id", disposition: "null_provenance" },
  {
    table: "asset_evidence_files",
    column: "owner_user_id",
    disposition: "delete_member_owned_or_reassign_household_native",
  },
  { table: "asset_links", column: "owner_user_id", disposition: "delete_member_relationship" },
  {
    table: "asset_person_links",
    column: "owner_user_id",
    disposition: "delete_member_relationship",
  },
  {
    table: "asset_snapshots",
    column: "owner_user_id",
    disposition: "delete_member_relationship",
  },
  {
    table: "asset_review_groups",
    column: "owner_user_id",
    disposition: "delete_member_relationship",
  },
  { table: "context_facts", column: "subject_user_id", disposition: "delete_member_relationship" },
  { table: "context_facts", column: "creator_user_id", disposition: "null_provenance" },
  { table: "context_facts", column: "last_actor_user_id", disposition: "null_provenance" },
  {
    table: "household_event_plans",
    column: "created_by_user_id",
    disposition: "null_provenance",
  },
  {
    table: "household_event_plans",
    column: "last_actor_user_id",
    disposition: "null_provenance",
  },
  {
    table: "household_event_plan_links",
    column: "linked_by_user_id",
    disposition: "null_provenance",
  },
  {
    table: "household_calendar_connections",
    column: "connector_user_id",
    disposition: "delete_member_relationship",
  },
  {
    table: "household_calendar_connections",
    column: "designated_by_user_id",
    disposition: "null_provenance",
  },
  { table: "person_references", column: "created_by_user_id", disposition: "null_provenance" },
  {
    table: "general_action_assets",
    column: "owner_user_id",
    disposition: "null_provenance",
  },
] as const satisfies readonly HouseholdAccountDeletionForeignKey[];

/** Account deletion follows ownership, never a legacy member storage key. */
export function accountDeletionRecordDisposition(
  ownership: HouseholdRecordOwnership,
): AccountDeletionRecordDisposition {
  return ownership === "household_native" ? "preserve_with_operational_key" : "delete";
}

/** Pick a stable operational key when another member remains; it grants no authority. */
export function accountDeletionReplacementMember(input: {
  roster: HouseholdRoster;
  userId: string;
}): string | null {
  return (
    activeHouseholdMembers(input.roster)
      .map((member) => member.userId)
      .filter((userId) => userId !== input.userId)
      .sort()[0] ?? null
  );
}

export const HOUSEHOLD_ACCOUNT_DELETION_REQUIRES_CO_OWNER =
  "Ask someone in this household to become an owner before deleting your account.";

export type AccountDeletionHouseholdTransition =
  | "depart"
  | "dissolve"
  | { refused: typeof HOUSEHOLD_ACCOUNT_DELETION_REQUIRES_CO_OWNER };

/** Decide the governance move that must precede deletion of the account row. */
export function accountDeletionHouseholdTransition(input: {
  roster: HouseholdRoster;
  userId: string;
}): AccountDeletionHouseholdTransition {
  const activeMembers = activeHouseholdMembers(input.roster);
  const deletingMember = activeMembers.find((member) => member.userId === input.userId);

  if (!deletingMember) return "depart";
  if (activeMembers.length === 1) return "dissolve";

  const otherOwnerRemains = activeHouseholdOwners(input.roster).some(
    (owner) => owner.userId !== input.userId,
  );
  if (deletingMember.role === "owner" && !otherOwnerRemains) {
    return { refused: HOUSEHOLD_ACCOUNT_DELETION_REQUIRES_CO_OWNER };
  }
  return "depart";
}

export type { HouseholdRoster } from "./household-governance";
