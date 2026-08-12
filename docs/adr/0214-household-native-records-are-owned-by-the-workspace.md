# Household-Native Records Are Owned By The Workspace

Phase Eight introduces a second ownership form for scoped Personal OS records: a household-native record is owned by the Household Workspace itself rather than by a member, and is first instantiated by General Actions and Routines. Ownership and visibility stay separate — widening a member-owned record to household scope never transfers it, and handing a record to the household is an explicit, confirmed, owner-only conversion with no claim-back path. A household-native record is visible to every active member by definition, grants every active member symmetric authority without Household Owner privilege or creator privilege, preserves creator and actor provenance for every change, is removed by archive rather than by any single member's permanent deletion, and survives departure and removal with its history and the departed member's attribution intact. This costs a workspace-owner representation that `owner_user_id NOT NULL` cannot express, and it buys the map's required distinction between "my errand you can see" and "the household's chore", so a departing partner cannot take the home's recurring obligations with them.

## Account deletion

Deleting a member account follows the same ownership boundary as departure, but
the deleted account can no longer remain as a foreign-key target. Member-owned
records are deleted with the account. Household-native records remain attached
to their Household Workspace. Their legacy non-null operational storage key is
not a member foreign key: it is reassigned deterministically when another active
member remains and stays as an opaque, non-resolving key through a sole member's
dissolution window. Creator and actor provenance becomes null where the account
row was the only attribution source. The key never grants authority or changes
provenance: active Household membership remains the only access path, and a
replacement member is not represented as the creator.

Household governance still applies. A member, or an Owner with another active
Owner, departs before the account row is deleted. A sole member dissolves their
workspace into its normal thirty-day recovery window. The last Owner of a
multi-member household must establish another Owner before account deletion, so
an account operation cannot strand the remaining members without governance.

The exhaustive column-level persistence inventory for this rule is exported as
`HOUSEHOLD_ACCOUNT_DELETION_FOREIGN_KEYS`. Each path has one of four explicit
dispositions: delete a member relationship, delete a member-owned root or
reassign its operational key when household-native, null a workspace-native key
that already supports memberless ownership, or null retained provenance. At the
family level:

- ownership-bearing roots: Saved Items, General Actions and Routines, Assets,
  Asset Memories, and Asset Evidence;
- workspace-native roots: Household Context Facts and Household Event Plans;
- retained children and history: Saved Item Events and Outcomes, General Action
  Events and context links, Asset Audit Events and Evidence Files, Event Plan
  links, and Person References;
- workspace identity and governance: the Household Workspace, memberships,
  invitations, confirmations, shares, and minimized audit trails.

Membership subjects, share recipients, dissolution confirmations, and self
Context subjects are relationships that end. Ownership keys are conditional on
the root's ownership form. The operational `owner_user_id` on household-native
General Actions and Assets is reassigned storage plumbing; it does not become
provenance for the replacement member. Saved Items already represent workspace
ownership with a null key. Creator, inviter, actor, linker, and workspace-creator
keys are retained provenance and become null. A child may cascade from its
retained parent, but never from a member provenance key.

`general_action_assets` is context, not an independently owned record. Its
Action and Asset are each authorized separately, and the link survives exactly
when both parents survive. The present `owner_user_id` is nevertheless a latent
gap: adapters use it operationally for lookup and deletion, and some write paths
copy a parent owner rather than the member who created the association. The
settled representation is nullable `created_by_user_id` provenance; adapters
must authorize through the two parents and account deletion must scrub the
creator rather than delete the link. Because the legacy values mix real actors
with copied parent storage keys, migration cannot truthfully distinguish them:
all existing values become null, and only writes made through the corrected
contract establish creator provenance. That migration is #404's dependent
layer, not documentation-only cleanup.
