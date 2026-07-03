import type { HouseholdMembership, PrivacyScope } from "@tendnote/domain";
import { canViewScopedRecord, scopedRecordVisibility } from "@tendnote/domain";
import type { HouseholdRecordShare, VisibilityRecordKind } from "./types";

export function canViewerSeeSeededHouseholdRecord(input: {
  callerUserId: string;
  record: {
    id: string;
    ownerUserId: string;
    householdId?: string | null;
    scope: PrivacyScope;
  };
  recordKind: VisibilityRecordKind;
  householdMemberships: readonly HouseholdMembership[];
  householdRecordShares: readonly HouseholdRecordShare[];
}) {
  const shares = input.householdRecordShares.filter(
    (share) => share.recordKind === input.recordKind && share.recordId === input.record.id,
  );

  return canViewScopedRecord({
    callerUserId: input.callerUserId,
    record: scopedRecordVisibility({
      ownerUserId: input.record.ownerUserId,
      scope: input.record.scope,
      householdId: input.record.householdId ?? null,
      shares,
    }),
    activeMemberships: input.householdMemberships.filter(
      (membership) => membership.status === "active",
    ),
  });
}
