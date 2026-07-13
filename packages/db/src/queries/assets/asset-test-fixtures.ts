import { seedHouseholdWithMembers } from "../households/household-fixtures";

/**
 * Shared fixtures for the asset seam suites (review, links, history): the
 * standard owner + one active member household most scope tests need, and an
 * audit-kinds reader for trail assertions — so every suite spells the common
 * scaffolding one way.
 */

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
