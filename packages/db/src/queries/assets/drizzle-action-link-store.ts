import {
  createGeneralActionAssetLinkSchema,
  generalActionAssetLinkSchema,
  HouseholdRecordUnavailableError,
} from "@tendnote/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import {
  assets,
  generalActionAssets,
  generalActions,
  householdMemberships,
  householdRecordShares,
  householdWorkspaces,
} from "../../schema";
import { createDrizzleGeneralActionStore } from "../general-actions/drizzle-store";
import { createGeneralActionAuthority } from "../general-actions/household-authority";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import type { GeneralActionAssetLinkStore } from "./review-types";

// Shared ordering contract: oldest first, id tiebreak — the in-memory store's
// `byCreatedThenId` mirrors this; keep the two in step.
const linkOrder = [asc(generalActionAssets.createdAt), asc(generalActionAssets.id)];

/** The Asset `attach` proof, expressed over rows already locked by the mutation. */
export function mayViewLockedAssetLinkTarget(
  record: {
    id: string;
    ownerUserId: string;
    scope: "private" | "shared" | "household";
    householdId: string | null;
  },
  input: {
    callerUserId: string;
    activeHouseholdIds: ReadonlySet<string>;
    selectedAssetIds: ReadonlySet<string>;
  },
): boolean {
  if (record.scope === "private") return record.ownerUserId === input.callerUserId;
  if (record.householdId === null || !input.activeHouseholdIds.has(record.householdId))
    return false;
  if (record.scope === "household") return true;
  return record.ownerUserId === input.callerUserId || input.selectedAssetIds.has(record.id);
}

// fallow-ignore-next-line complexity -- One transaction-ordering primitive must discover and lock governance before records, detect household drift, and return both parent authorities together so link mutations cannot split the race fence.
async function lockAndAuthorizeLinkParents(
  db: DatabaseExecutor,
  input: {
    callerUserId: string;
    generalActionIds: string[];
    assetIds: string[];
  },
) {
  const actionIds = [...new Set(input.generalActionIds)];
  const assetIds = [...new Set(input.assetIds)];
  if (assetIds.length === 0) {
    return {
      actionIds: new Set<string>(),
      editableAssetIds: new Set<string>(),
      visibleAssetIds: new Set<string>(),
    };
  }

  // Discover then lock every implicated governance row before locking records,
  // matching Household membership transitions. If a record changes households
  // between discovery and its row lock, fail closed rather than trusting a
  // workspace whose roster was not serialized with this mutation.
  const discoveredActions =
    actionIds.length === 0
      ? []
      : await db
          .select({ householdId: generalActions.householdId })
          .from(generalActions)
          .where(inArray(generalActions.id, actionIds));
  const discoveredAssets = await db
    .select({ householdId: assets.householdId })
    .from(assets)
    .where(inArray(assets.id, assetIds));
  const discoveredHouseholdIds = [
    ...new Set(
      [...discoveredActions, ...discoveredAssets]
        .map((record) => record.householdId)
        .filter((id): id is string => id !== null),
    ),
  ].sort();
  if (discoveredHouseholdIds.length > 0) {
    await db
      .select({ id: householdWorkspaces.id })
      .from(householdWorkspaces)
      .where(inArray(householdWorkspaces.id, discoveredHouseholdIds))
      .orderBy(householdWorkspaces.id)
      .for("update");
  }

  const lockedActions =
    actionIds.length === 0
      ? []
      : await db
          .select({
            id: generalActions.id,
            ownerUserId: generalActions.ownerUserId,
            ownership: generalActions.ownership,
            householdId: generalActions.householdId,
          })
          .from(generalActions)
          .where(inArray(generalActions.id, actionIds))
          .orderBy(generalActions.id)
          .for("update");
  const lockedAssets = await db
    .select({
      id: assets.id,
      ownerUserId: assets.ownerUserId,
      ownership: assets.ownership,
      householdId: assets.householdId,
      scope: assets.scope,
      status: assets.status,
    })
    .from(assets)
    .where(inArray(assets.id, assetIds))
    .orderBy(assets.id)
    .for("update");

  const lockedHouseholdIds = new Set(discoveredHouseholdIds);
  const currentHouseholdIds = [...lockedActions, ...lockedAssets]
    .map((record) => record.householdId)
    .filter((id): id is string => id !== null);
  if (currentHouseholdIds.some((id) => !lockedHouseholdIds.has(id))) {
    return {
      actionIds: new Set<string>(),
      editableAssetIds: new Set<string>(),
      visibleAssetIds: new Set<string>(),
    };
  }

  const memberships =
    discoveredHouseholdIds.length === 0
      ? []
      : await db
          .select({ householdId: householdMemberships.householdId })
          .from(householdMemberships)
          .where(
            and(
              eq(householdMemberships.userId, input.callerUserId),
              eq(householdMemberships.status, "active"),
              inArray(householdMemberships.householdId, discoveredHouseholdIds),
            ),
          );
  const activeHouseholdIds = new Set(memberships.map((row) => row.householdId));
  const selectedShares =
    activeHouseholdIds.size === 0
      ? []
      : await db
          .select({ recordId: householdRecordShares.recordId })
          .from(householdRecordShares)
          .where(
            and(
              eq(householdRecordShares.recordKind, "asset"),
              eq(householdRecordShares.sharedWithUserId, input.callerUserId),
              inArray(householdRecordShares.recordId, assetIds),
              inArray(householdRecordShares.householdId, [...activeHouseholdIds]),
            ),
          );
  const selectedAssetIds = new Set(selectedShares.map((share) => share.recordId));
  const mayEdit = (record: {
    ownerUserId: string;
    ownership: "member_owned" | "household_native";
    householdId: string | null;
  }) =>
    record.ownership === "member_owned"
      ? record.ownerUserId === input.callerUserId
      : record.householdId !== null && activeHouseholdIds.has(record.householdId);
  return {
    actionIds: new Set(lockedActions.filter(mayEdit).map((record) => record.id)),
    editableAssetIds: new Set(lockedAssets.filter(mayEdit).map((record) => record.id)),
    visibleAssetIds: new Set(
      lockedAssets
        .filter((record) =>
          mayViewLockedAssetLinkTarget(record, {
            callerUserId: input.callerUserId,
            activeHouseholdIds,
            selectedAssetIds,
          }),
        )
        .map((record) => record.id),
    ),
  };
}

/**
 * Drizzle-backed General Action ↔ Asset link store (#199). Creation is
 * idempotent per (action, asset) pair via the unique index; the raw list reads
 * are consumed only by the bridge query layer (`action-links.ts`), which
 * scope-filters both sides per record before anything reaches a surface.
 */
export function createDrizzleGeneralActionAssetLinkStore(): GeneralActionAssetLinkStore {
  return {
    async createGeneralActionAssetLink(values) {
      const parsed = createGeneralActionAssetLinkSchema.parse(values);
      const [row] = await getDb()
        .insert(generalActionAssets)
        .values(parsed)
        .onConflictDoNothing({
          target: [generalActionAssets.generalActionId, generalActionAssets.assetId],
        })
        .returning();
      if (row) {
        return generalActionAssetLinkSchema.parse(row);
      }
      // The pair already exists — idempotent creation returns the existing row.
      const [existing] = await getDb()
        .select()
        .from(generalActionAssets)
        .where(
          and(
            eq(generalActionAssets.generalActionId, parsed.generalActionId),
            eq(generalActionAssets.assetId, parsed.assetId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error("Failed to link the action to the asset.");
      }
      return generalActionAssetLinkSchema.parse(existing);
    },
    async listGeneralActionAssetLinksForActions(input) {
      if (input.generalActionIds.length === 0) {
        return [];
      }
      const rows = await getDb()
        .select()
        .from(generalActionAssets)
        .where(inArray(generalActionAssets.generalActionId, input.generalActionIds))
        .orderBy(...linkOrder);
      return rows.map((row) => generalActionAssetLinkSchema.parse(row));
    },
    async listGeneralActionAssetLinksForAsset(input) {
      const rows = await getDb()
        .select()
        .from(generalActionAssets)
        .where(eq(generalActionAssets.assetId, input.assetId))
        .orderBy(...linkOrder);
      return rows.map((row) => generalActionAssetLinkSchema.parse(row));
    },
    // fallow-ignore-next-line complexity -- This boundary deliberately performs the same owner-or-visible lookup and edit-authority proof per Action; collapsing those states would turn visibility into mutation authority.
    async listAuthorizedGeneralActionAssetLinkActionIds(input) {
      const actions = createDrizzleGeneralActionStore();
      const authority = createGeneralActionAuthority({
        ...actions,
        ...createDrizzleHouseholdStore(),
      });
      const authorized: string[] = [];
      for (const generalActionId of new Set(input.generalActionIds)) {
        const owned = await actions.getGeneralAction({
          ownerUserId: input.callerUserId,
          generalActionId,
        });
        const visible = owned
          ? owned
          : await actions.getVisibleGeneralAction({
              callerUserId: input.callerUserId,
              generalActionId,
            });
        if (!visible) continue;
        try {
          await authority.requireGeneralActionAuthority({
            actorUserId: input.callerUserId,
            action: visible,
            operation: "edit",
          });
          authorized.push(generalActionId);
        } catch (error) {
          if (!(error instanceof HouseholdRecordUnavailableError)) throw error;
        }
      }
      return authorized;
    },
    async repointGeneralActionAssetLinks(input) {
      // fallow-ignore-next-line complexity -- Repointing is one atomic collision-aware graph rewrite after both parent authorities and lifecycle statuses are locked and rechecked.
      return getDb().transaction(async (tx) => {
        const requestedActionIds = new Set(input.generalActionIds);
        const authorized = await lockAndAuthorizeLinkParents(tx, {
          callerUserId: input.callerUserId,
          generalActionIds: input.generalActionIds,
          assetIds: [input.fromAssetId, input.toAssetId],
        });
        if (!authorized.editableAssetIds.has(input.fromAssetId)) {
          return { outcome: "unauthorized" };
        }
        // Re-pointing attaches the caller's independently authorized Action to
        // the chosen Asset; it does not edit that Asset. Match `requireLinkTarget`
        // and the Asset `attach` operation by rechecking target visibility under
        // the same governance and record locks.
        if (
          !authorized.visibleAssetIds.has(input.toAssetId) ||
          authorized.actionIds.size !== requestedActionIds.size
        ) {
          return { outcome: "unauthorized" };
        }
        const lockedAssets = await tx
          .select({ id: assets.id, status: assets.status })
          .from(assets)
          .where(inArray(assets.id, [input.fromAssetId, input.toAssetId]));
        const statuses = new Map(lockedAssets.map((asset) => [asset.id, asset.status]));
        if (statuses.get(input.fromAssetId) !== input.fromAssetStatus) {
          return { outcome: "stale" };
        }
        if (statuses.get(input.toAssetId) !== input.toAssetStatus) {
          return { outcome: "stale" };
        }

        const fromRows = await tx
          .select()
          .from(generalActionAssets)
          .where(
            and(
              eq(generalActionAssets.assetId, input.fromAssetId),
              inArray(generalActionAssets.generalActionId, [...authorized.actionIds]),
            ),
          )
          .orderBy(...linkOrder)
          .for("update");

        let repointed = 0;
        for (const row of fromRows) {
          const [collision] = await tx
            .select({ id: generalActionAssets.id })
            .from(generalActionAssets)
            .where(
              and(
                eq(generalActionAssets.generalActionId, row.generalActionId),
                eq(generalActionAssets.assetId, input.toAssetId),
              ),
            )
            .limit(1);
          if (collision) {
            // The action already links to the target — the stale row just goes.
            await tx.delete(generalActionAssets).where(eq(generalActionAssets.id, row.id));
            continue;
          }
          const updated = await tx
            .update(generalActionAssets)
            .set({ assetId: input.toAssetId })
            .where(eq(generalActionAssets.id, row.id))
            .returning({ id: generalActionAssets.id });
          repointed += updated.length;
        }
        return { outcome: "applied", count: repointed };
      });
    },
    async deleteGeneralActionAssetLink(input) {
      await getDb().transaction(async (tx) => {
        const authorized = await lockAndAuthorizeLinkParents(tx, {
          callerUserId: input.callerUserId,
          generalActionIds: [input.generalActionId],
          assetIds: [input.assetId],
        });
        if (!authorized.actionIds.has(input.generalActionId)) return;
        if (!authorized.editableAssetIds.has(input.assetId)) return;
        await tx
          .delete(generalActionAssets)
          .where(
            and(
              eq(generalActionAssets.id, input.linkId),
              eq(generalActionAssets.generalActionId, input.generalActionId),
              eq(generalActionAssets.assetId, input.assetId),
            ),
          );
      });
    },
  };
}
