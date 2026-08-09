import type {
  HouseholdMembership,
  HouseholdOperation,
  HouseholdRecordLifecycle,
  HouseholdRequestPurpose,
  PrivacyScope,
  Sensitivity,
} from "@tendnote/domain";
import { evaluateHouseholdAuthorization } from "@tendnote/domain";
import type { HouseholdRecordShare, VisibilityRecordKind } from "./types";

/**
 * The Household Authorization Proof over facts a caller already holds.
 *
 * Every in-memory store's scope filtering goes through here, so the seeded and
 * database-backed halves of a domain cannot answer the visibility question
 * differently. It is the synchronous form because its facts are already loaded;
 * anything reading facts from storage uses `createHouseholdAuthorizationProver`
 * instead, which re-reads them (ADR 0219).
 *
 * `operation` defaults to `view` and `purpose` to `direct`, which is what a
 * read-side filter is asking. A caller acting on the record passes the operation
 * it is about to perform.
 */
export function canViewerSeeSeededHouseholdRecord(input: {
  callerUserId: string;
  record: {
    id: string;
    ownerUserId: string;
    householdId?: string | null;
    scope: PrivacyScope;
    lifecycle?: HouseholdRecordLifecycle;
    sensitivity?: Sensitivity;
    excludedUserIds?: readonly string[];
  };
  recordKind: VisibilityRecordKind;
  householdMemberships: readonly HouseholdMembership[];
  householdRecordShares: readonly HouseholdRecordShare[];
  operation?: HouseholdOperation;
  purpose?: HouseholdRequestPurpose;
}): boolean {
  const audienceUserIds = input.householdRecordShares
    .filter((share) => share.recordKind === input.recordKind && share.recordId === input.record.id)
    .map((share) => share.sharedWithUserId);

  return evaluateHouseholdAuthorization({
    callerUserId: input.callerUserId,
    operation: input.operation ?? "view",
    purpose: input.purpose,
    subject: {
      kind: input.recordKind,
      id: input.record.id,
      ownerUserId: input.record.ownerUserId,
      scope: input.record.scope,
      householdId: input.record.householdId ?? null,
      audienceUserIds,
      lifecycle: input.record.lifecycle,
      sensitivity: input.record.sensitivity,
      excludedUserIds: input.record.excludedUserIds,
    },
    callerActiveMemberships: input.householdMemberships.filter(
      (membership) => membership.status === "active",
    ),
  }).authorized;
}
