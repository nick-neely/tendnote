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
  householdWorkspaces,
} from "../../schema";
import { createDrizzleGeneralActionStore } from "../general-actions/drizzle-store";
import { createGeneralActionAuthority } from "../general-actions/household-authority";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import type { GeneralActionAssetLinkStore } from "./review-types";

// Shared ordering contract: oldest first, id tiebreak — the in-memory store's
// `byCreatedThenId` mirrors this; keep the two in step.
const linkOrder = [asc(generalActionAssets.createdAt), asc(generalActionAssets.id)];

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
  if (actionIds.length === 0 || assetIds.length === 0) {
    return { actionIds: new Set<string>(), assetIds: new Set<string>() };
  }

  // Discover then lock every implicated governance row before locking records,
  // matching Household membership transitions. If a record changes households
  // between discovery and its row lock, fail closed rather than trusting a
  // workspace whose roster was not serialized with this mutation.
  const discoveredActions = await db
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

  const lockedActions = await db
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
    return { actionIds: new Set<string>(), assetIds: new Set<string>() };
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
    assetIds: new Set(lockedAssets.filter(mayEdit).map((record) => record.id)),
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
      if (input.generalActionIds.length === 0) {
        return 0;
      }
      return getDb().transaction(async (tx) => {
        const authorized = await lockAndAuthorizeLinkParents(tx, {
          callerUserId: input.callerUserId,
          generalActionIds: input.generalActionIds,
          assetIds: [input.fromAssetId, input.toAssetId],
        });
        if (authorized.assetIds.size !== 2 || authorized.actionIds.size === 0) {
          return 0;
        }
        const lockedAssets = await tx
          .select({ id: assets.id, status: assets.status })
          .from(assets)
          .where(inArray(assets.id, [input.fromAssetId, input.toAssetId]));
        const statuses = new Map(lockedAssets.map((asset) => [asset.id, asset.status]));
        if (statuses.get(input.fromAssetId) !== input.fromAssetStatus) return 0;
        if (statuses.get(input.toAssetId) !== input.toAssetStatus) return 0;

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
        return repointed;
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
        if (!authorized.assetIds.has(input.assetId)) return;
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
