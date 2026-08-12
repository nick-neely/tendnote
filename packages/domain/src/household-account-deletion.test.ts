import { describe, expect, it } from "vitest";
import {
  accountDeletionHouseholdTransition,
  accountDeletionRecordDisposition,
  accountDeletionReplacementMember,
  HOUSEHOLD_ACCOUNT_DELETION_FOREIGN_KEYS,
  HOUSEHOLD_ACCOUNT_DELETION_REQUIRES_CO_OWNER,
  type HouseholdRoster,
} from "./household-account-deletion";

const SOLE_OWNER: HouseholdRoster = [{ userId: "ana", role: "owner", status: "active" }];
const OWNER_AND_MEMBER: HouseholdRoster = [
  { userId: "ana", role: "owner", status: "active" },
  { userId: "ben", role: "member", status: "active" },
];
const TWO_OWNERS: HouseholdRoster = [
  { userId: "ana", role: "owner", status: "active" },
  { userId: "ben", role: "owner", status: "active" },
];

describe("account deletion record ownership", () => {
  it("deletes member-owned records and preserves workspace-owned records", () => {
    expect(accountDeletionRecordDisposition("member_owned")).toBe("delete");
    expect(accountDeletionRecordDisposition("household_native")).toBe(
      "preserve_with_operational_key",
    );
  });

  it("selects a stable remaining member for operational storage keys", () => {
    expect(
      accountDeletionReplacementMember({
        roster: [{ userId: "zoe", role: "member", status: "active" }, ...TWO_OWNERS],
        userId: "ana",
      }),
    ).toBe("ben");
    expect(accountDeletionReplacementMember({ roster: SOLE_OWNER, userId: "ana" })).toBeNull();
  });

  it("pins every Household member foreign key to one deletion disposition", () => {
    const paths = HOUSEHOLD_ACCOUNT_DELETION_FOREIGN_KEYS.map(
      ({ table, column }) => `${table}.${column}`,
    );

    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([
      "household_workspaces.owner_user_id",
      "household_memberships.user_id",
      "household_memberships.invited_by_user_id",
      "household_memberships.pending_role_offered_by_user_id",
      "household_dissolution_confirmations.user_id",
      "household_record_shares.shared_with_user_id",
      "household_record_shares.shared_by_user_id",
      "household_invitations.invited_by_user_id",
      "household_invitations.accepted_by_user_id",
      "audit_log.owner_user_id",
      "saved_items.owner_user_id",
      "saved_items.created_by_user_id",
      "saved_items.last_actor_user_id",
      "saved_item_events.owner_user_id",
      "saved_item_events.actor_user_id",
      "general_actions.owner_user_id",
      "general_actions.responsibility_holder_user_id",
      "general_actions.created_by_user_id",
      "general_actions.last_actor_user_id",
      "general_action_events.owner_user_id",
      "general_action_events.actor_user_id",
      "general_action_offer_declines.user_id",
      "assets.owner_user_id",
      "assets.created_by_user_id",
      "assets.last_actor_user_id",
      "asset_audit_events.owner_user_id",
      "asset_audit_events.actor_user_id",
      "asset_memories.owner_user_id",
      "asset_memories.created_by_user_id",
      "asset_memories.last_actor_user_id",
      "asset_evidence.owner_user_id",
      "asset_evidence.created_by_user_id",
      "asset_evidence.last_actor_user_id",
      "asset_evidence_files.owner_user_id",
      "asset_links.owner_user_id",
      "asset_person_links.owner_user_id",
      "asset_snapshots.owner_user_id",
      "asset_review_groups.owner_user_id",
      "context_facts.subject_user_id",
      "context_facts.creator_user_id",
      "context_facts.last_actor_user_id",
      "household_event_plans.created_by_user_id",
      "household_event_plans.last_actor_user_id",
      "household_event_plan_links.linked_by_user_id",
      "household_calendar_connections.connector_user_id",
      "household_calendar_connections.designated_by_user_id",
      "person_references.created_by_user_id",
      "general_action_assets.created_by_user_id",
    ]);
  });

  it("retains history and children by nulling member provenance", () => {
    const retainedProvenance = HOUSEHOLD_ACCOUNT_DELETION_FOREIGN_KEYS.filter(
      ({ disposition }) => disposition === "null_provenance",
    ).map(({ table, column }) => `${table}.${column}`);

    expect(retainedProvenance).toContain("general_action_events.actor_user_id");
    expect(retainedProvenance).toContain("household_event_plans.created_by_user_id");
    expect(retainedProvenance).toContain("general_action_assets.created_by_user_id");
  });
});

describe("account deletion household transition", () => {
  it("uses the ordinary departure path when another active owner remains", () => {
    expect(accountDeletionHouseholdTransition({ roster: TWO_OWNERS, userId: "ana" })).toBe(
      "depart",
    );
    expect(accountDeletionHouseholdTransition({ roster: OWNER_AND_MEMBER, userId: "ben" })).toBe(
      "depart",
    );
  });

  it("dissolves a household when the deleting account is its only member", () => {
    expect(accountDeletionHouseholdTransition({ roster: SOLE_OWNER, userId: "ana" })).toBe(
      "dissolve",
    );
  });

  it("requires a co-owner before the last owner can delete their account", () => {
    expect(accountDeletionHouseholdTransition({ roster: OWNER_AND_MEMBER, userId: "ana" })).toEqual(
      { refused: HOUSEHOLD_ACCOUNT_DELETION_REQUIRES_CO_OWNER },
    );
  });
});
