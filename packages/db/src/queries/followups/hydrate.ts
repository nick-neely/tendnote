import type { Followup } from "@tendnote/domain";
import type { FollowupLifecycleStore, FollowupWithContext } from "./types";

type FollowupHydrationStore = Pick<
  FollowupLifecycleStore,
  "getHouseholdWorkspaces" | "listHouseholdRecordSharesForRecords"
>;

/** Adds the audience facts a Follow-Up surface needs without widening visibility. */
export async function hydrateFollowup(
  store: FollowupHydrationStore,
  followup: Followup,
): Promise<FollowupWithContext> {
  const [hydrated] = await hydrateFollowups(store, [followup]);
  if (!hydrated) throw new Error("Failed to hydrate Follow-Up.");
  return hydrated;
}

/** Hydrates a bounded read set with two queries total, never two queries per row. */
export async function hydrateFollowups(
  store: FollowupHydrationStore,
  followups: Followup[],
): Promise<FollowupWithContext[]> {
  const householdIds = [
    ...new Set(
      followups.flatMap((followup) =>
        followup.scope !== "private" && followup.householdId ? [followup.householdId] : [],
      ),
    ),
  ];
  const sharedFollowups = followups.filter(
    (followup) => followup.scope === "shared" && followup.householdId,
  );
  const [households, shares] = await Promise.all([
    householdIds.length > 0 ? store.getHouseholdWorkspaces({ householdIds }) : Promise.resolve([]),
    sharedFollowups.length > 0
      ? store.listHouseholdRecordSharesForRecords({
          householdIds,
          recordKind: "followup",
          recordIds: sharedFollowups.map((followup) => followup.id),
        })
      : Promise.resolve([]),
  ]);
  const householdNameById = new Map(households.map((household) => [household.id, household.name]));
  const shareCountByRecordId = new Map<string, number>();
  for (const share of shares) {
    shareCountByRecordId.set(share.recordId, (shareCountByRecordId.get(share.recordId) ?? 0) + 1);
  }

  return followups.map((followup) => ({
    ...followup,
    householdName: followup.householdId
      ? (householdNameById.get(followup.householdId) ?? null)
      : null,
    sharedWithCount: followup.scope === "shared" ? (shareCountByRecordId.get(followup.id) ?? 0) : 0,
  }));
}
