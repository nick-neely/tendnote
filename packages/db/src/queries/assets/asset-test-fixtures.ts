import { seedHouseholdWithMembers } from "../households/household-fixtures";
import type { SourceRecordResolutionStore } from "../source-records/types";

/**
 * Shared fixtures for the asset seam suites (review, links, history): the
 * standard owner + one active member household most scope tests need, the two
 * neighbouring records asset context leans on (a person to link, a source record
 * to ground an inference), and an audit-kinds reader for trail assertions — so
 * every suite spells the common scaffolding one way.
 */

/** The store surface these fixtures write through — people and source records. */
type ContextRecordStore = Pick<SourceRecordResolutionStore, "createPerson" | "createSourceRecord">;

/** One of the owner's people, with the defaults a link test never cares about. */
export function seedPerson(store: ContextRecordStore, ownerUserId: string, displayName = "Marcus") {
  return store.createPerson({
    ownerUserId,
    displayName,
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });
}

/** The grounding an inferred suggestion must come from (ADR 0151). */
export function seedSourceRecord(
  store: ContextRecordStore,
  ownerUserId: string,
  content = "The EDR3RXD1 filter fits the kitchen fridge.",
) {
  return store.createSourceRecord({
    ownerUserId,
    sourceType: "manual",
    content,
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
  });
}

/** Seeds the two-member household (owner + one active member) scope tests use. */
export function seedOwnerMemberHousehold(
  store: Parameters<typeof seedHouseholdWithMembers>[0],
  ownerUserId: string,
  memberUserId: string,
) {
  return seedHouseholdWithMembers(store, {
    ownerUserId,
    members: [
      [ownerUserId, "owner"],
      [memberUserId, "member"],
    ],
  });
}

/** A reader over one asset's audit trail that answers with just the event kinds. */
export function createAuditKindsReader(
  lifecycle: {
    listAssetAudit: (input: {
      ownerUserId: string;
      assetId: string;
    }) => Promise<{ kind: string }[]>;
  },
  defaultOwnerUserId: string,
) {
  return async (assetId: string, ownerUserId = defaultOwnerUserId) =>
    (await lifecycle.listAssetAudit({ ownerUserId, assetId })).map((event) => event.kind);
}
