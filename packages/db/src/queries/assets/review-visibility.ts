import {
  type Asset,
  type AssetMemoryScope,
  AssetValidationError,
  defaultChildScopeForAsset,
  requireChildScopeWithinAsset,
  resolveLinkedChildVisibility,
} from "@tendnote/domain";
import { resolveRecordVisibility } from "../households/record-visibility";
import type { AssetReviewLifecycleStore } from "./review-types";

export type ResolvedAssetChildVisibility = {
  scope: AssetMemoryScope;
  householdId: string | null;
  selectedUserIds: string[];
};

/** Resolves a child audience against the parent Asset's visibility ceiling. */
export async function resolveAssetChildVisibility(
  store: AssetReviewLifecycleStore,
  input: {
    ownerUserId: string;
    anchor: Asset;
    scope?: AssetMemoryScope;
    selectedUserIds?: string[];
  },
): Promise<ResolvedAssetChildVisibility> {
  const scope = input.scope ?? defaultChildScopeForAsset(input.anchor.scope);
  requireChildScopeWithinAsset({ childScope: scope, assetScope: input.anchor.scope });
  if (scope === "private") return { scope, householdId: null, selectedUserIds: [] };

  const householdId = input.anchor.householdId;
  if (!householdId) {
    throw new AssetValidationError("Sharing an asset detail needs a household.");
  }

  let selectedUserIds = input.selectedUserIds ?? [];
  if (scope === "shared" && input.anchor.scope === "shared") {
    const parentShares = await store.listHouseholdRecordShares({
      householdId,
      recordKind: "asset",
      recordId: input.anchor.id,
    });
    const parentAudience = new Set([
      input.anchor.ownerUserId,
      ...parentShares.map((share) => share.sharedWithUserId),
    ]);
    if (input.selectedUserIds === undefined) {
      selectedUserIds = [...parentAudience].filter((userId) => userId !== input.ownerUserId);
    }
    if (selectedUserIds.some((userId) => !parentAudience.has(userId))) {
      throw new AssetValidationError(
        "A detail can't be shared with someone who cannot see its asset.",
      );
    }
  }

  await resolveRecordVisibility(
    store,
    { ownerUserId: input.ownerUserId, scope, householdId, selectedUserIds },
    {
      recordNoun: "asset detail",
      recordNounWithArticle: "an asset detail",
      fail: (message) => new AssetValidationError(message),
    },
  );
  return { scope, householdId, selectedUserIds: scope === "shared" ? selectedUserIds : [] };
}

/** Materializes selected-member rows after the child record itself exists. */
export async function writeAssetChildShares(
  store: AssetReviewLifecycleStore,
  input: ResolvedAssetChildVisibility & {
    ownerUserId: string;
    recordKind: "asset_memory" | "asset_evidence";
    recordId: string;
  },
): Promise<void> {
  if (input.scope !== "shared" || !input.householdId) return;
  for (const sharedWithUserId of input.selectedUserIds) {
    await store.createHouseholdRecordShare({
      householdId: input.householdId,
      recordKind: input.recordKind,
      recordId: input.recordId,
      sharedWithUserId,
      sharedByUserId: input.ownerUserId,
    });
  }
}

type ReanchoredChild = {
  id: string;
  ownerUserId: string;
  scope: AssetMemoryScope;
  householdId: string | null;
};

/** Clamps a re-anchored child and reconciles the middle selected audience. */
export async function resolveReanchoredAssetChildVisibility(
  store: AssetReviewLifecycleStore,
  input: {
    child: ReanchoredChild;
    recordKind: "asset_memory" | "asset_evidence";
    target: Asset;
  },
): Promise<ResolvedAssetChildVisibility> {
  const linked = resolveLinkedChildVisibility({
    childScope: input.child.scope,
    target: input.target,
  });
  if (linked.scope !== "shared") {
    return { ...linked, selectedUserIds: [] };
  }

  const currentSelectedUserIds =
    input.child.scope === "shared" && input.child.householdId
      ? (
          await store.listHouseholdRecordShares({
            householdId: input.child.householdId,
            recordKind: input.recordKind,
            recordId: input.child.id,
          })
        ).map((share) => share.sharedWithUserId)
      : [];

  if (input.target.scope !== "shared") {
    const targetHouseholdId = input.target.householdId;
    if (!targetHouseholdId) {
      return { scope: "private", householdId: null, selectedUserIds: [] };
    }
    const activeMemberships = await store.listHouseholdMemberships({
      householdId: targetHouseholdId,
      status: "active",
    });
    const activeUserIds = new Set(activeMemberships.map((membership) => membership.userId));
    const selectedUserIds = currentSelectedUserIds.filter((userId) => activeUserIds.has(userId));
    if (selectedUserIds.length === 0) {
      return { scope: "private", householdId: null, selectedUserIds: [] };
    }
    return resolveAssetChildVisibility(store, {
      ownerUserId: input.child.ownerUserId,
      anchor: input.target,
      scope: "shared",
      selectedUserIds,
    });
  }

  const targetVisibility = await resolveAssetChildVisibility(store, {
    ownerUserId: input.child.ownerUserId,
    anchor: input.target,
    scope: "shared",
  });
  const selectedUserIds =
    input.child.scope === "household"
      ? targetVisibility.selectedUserIds
      : currentSelectedUserIds.filter((userId) =>
          targetVisibility.selectedUserIds.includes(userId),
        );
  if (selectedUserIds.length === 0) {
    return { scope: "private", householdId: null, selectedUserIds: [] };
  }
  return { ...targetVisibility, selectedUserIds };
}

/** Replaces stale child share rows after a link/re-anchor visibility change. */
export async function replaceReanchoredAssetChildShares(
  store: AssetReviewLifecycleStore,
  input: ResolvedAssetChildVisibility & {
    previousHouseholdId: string | null;
    ownerUserId: string;
    recordKind: "asset_memory" | "asset_evidence";
    recordId: string;
  },
): Promise<void> {
  if (input.previousHouseholdId) {
    await store.deleteHouseholdRecordShares({
      householdId: input.previousHouseholdId,
      recordKind: input.recordKind,
      recordId: input.recordId,
    });
  }
  await writeAssetChildShares(store, input);
}
