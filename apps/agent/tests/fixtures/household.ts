import {
  createHouseholdLifecycle,
  createInMemoryHouseholdStore,
} from "@tendnote/db/queries/households";
import type { PrivacyScope } from "@tendnote/domain";

/**
 * Shared Phase 4 household fixture. Seeds a real household through the on-main
 * household lifecycle + in-memory store — an owner, one active member, and one
 * removed member — and returns the household id plus a `canView` helper bound to
 * the same lifecycle. Tests then exercise the real visibility query
 * (`canViewHouseholdRecord`) rather than hand-built membership fixtures.
 */
export const HOUSEHOLD_OWNER_ID = "household-owner";
export const HOUSEHOLD_MEMBER_ID = "household-member";
export const REMOVED_MEMBER_ID = "removed-member";

type ScopedRecord = {
  id: string;
  ownerUserId: string;
  householdId?: string | null;
  scope: PrivacyScope;
};

export async function seedHouseholdWithMembers() {
  const store = createInMemoryHouseholdStore();
  const lifecycle = createHouseholdLifecycle(store);

  const { household } = await lifecycle.createHousehold({
    ownerUserId: HOUSEHOLD_OWNER_ID,
    name: "Test Household",
  });

  await lifecycle.inviteMember({
    ownerUserId: HOUSEHOLD_OWNER_ID,
    householdId: household.id,
    invitedUserId: HOUSEHOLD_MEMBER_ID,
  });
  await lifecycle.acceptInvite({ userId: HOUSEHOLD_MEMBER_ID, householdId: household.id });

  await lifecycle.inviteMember({
    ownerUserId: HOUSEHOLD_OWNER_ID,
    householdId: household.id,
    invitedUserId: REMOVED_MEMBER_ID,
  });
  await lifecycle.acceptInvite({ userId: REMOVED_MEMBER_ID, householdId: household.id });
  await lifecycle.removeMember({
    ownerUserId: HOUSEHOLD_OWNER_ID,
    householdId: household.id,
    memberUserId: REMOVED_MEMBER_ID,
  });

  const canView = (input: { callerUserId: string; record: ScopedRecord }) =>
    lifecycle.canViewHouseholdRecord({
      callerUserId: input.callerUserId,
      ownerUserId: input.record.ownerUserId,
      householdId: input.record.householdId ?? null,
      scope: input.record.scope,
      recordKind: "source_record",
      recordId: input.record.id,
    });

  return { householdId: household.id, canView };
}
