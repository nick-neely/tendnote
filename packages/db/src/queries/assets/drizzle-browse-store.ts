import { assetSchema, DURABLE_ASSET_STATUSES } from "@tendnote/domain";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import { assetReviewGroups, assets, generalActions } from "../../schema";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import type { AssetBrowseStore, ListAssetBrowseRowsInput } from "./browse-types";

const visibleAssets = alias(assets, "a");
const countedReviewGroups = alias(assetReviewGroups, "counted_review_group");
// Raw correlated subqueries must name the alias explicitly. Interpolating
// `visibleAssets.id` here renders an unqualified `id` in Drizzle.
const visibleAssetId = sql.raw('"a"."id"');

function pendingReviewMembers(groupAlias: "arg" | "counted_review_group") {
  const groupId = sql.raw(`"${groupAlias}"."id"`);
  const groupAssetId = sql.raw(`"${groupAlias}"."asset_id"`);
  const groupOwnerId = sql.raw(`"${groupAlias}"."owner_user_id"`);
  return sql<boolean>`(
    exists (
      select 1 from assets pending_asset
      where pending_asset.id = ${groupAssetId}
        and pending_asset.owner_user_id = ${groupOwnerId}
        and pending_asset.status = 'suggested'
    )
    or exists (
      select 1 from asset_memories pending_memory
      where pending_memory.review_group_id = ${groupId}
        and pending_memory.owner_user_id = ${groupOwnerId}
        and pending_memory.status = 'suggested'
    )
  )`;
}

function pendingReviewForAsset(callerUserId: string) {
  return sql<boolean>`exists (
    select 1
    from asset_review_groups arg
    where arg.asset_id = ${visibleAssetId}
      and arg.owner_user_id = ${callerUserId}
      and ${pendingReviewMembers("arg")}
  )`;
}

function nextDueActionForAsset(callerUserId: string) {
  return sql<Date | null>`(
    select min(ga.due_at)
    from general_action_assets gaa
    join general_actions ga on ga.id = gaa.general_action_id
    where gaa.asset_id = ${visibleAssetId}
      and ga.status in ('open', 'deferred')
      and ga.due_at is not null
      and ${visibleHouseholdRecordSql({
        callerUserId,
        tableAlias: "ga",
        recordKind: "general_action",
      })}
  )`.mapWith(generalActions.dueAt);
}

function browseOrder(input: ListAssetBrowseRowsInput) {
  const name = sql`lower(${visibleAssets.name})`;
  const nextDue = nextDueActionForAsset(input.callerUserId);
  const needsReview = pendingReviewForAsset(input.callerUserId);
  if (input.sort === "due_action") {
    return [sql`${nextDue} asc nulls last`, asc(name), desc(visibleAssets.createdAt)];
  }
  if (input.sort === "needs_review") {
    return [desc(needsReview), asc(name), desc(visibleAssets.createdAt)];
  }
  if (input.sort === "recently_added") {
    return [desc(visibleAssets.createdAt), asc(name), asc(visibleAssets.id)];
  }
  return [asc(name), desc(visibleAssets.createdAt), asc(visibleAssets.id)];
}

/** One database-owned browse query: scope, metadata, filters, ordering, and paging. */
export function createDrizzleAssetBrowseStore(): AssetBrowseStore {
  return {
    // fallow-ignore-next-line complexity
    async listAssetBrowseRows(input) {
      const needsReview = pendingReviewForAsset(input.callerUserId);
      const nextDueActionAt = nextDueActionForAsset(input.callerUserId);
      const rows = await getDb()
        .select({
          asset: visibleAssets,
          needsReview: needsReview.as("needs_review"),
          nextDueActionAt: nextDueActionAt.as("next_due_action_at"),
        })
        .from(visibleAssets)
        .where(
          and(
            inArray(visibleAssets.status, [...DURABLE_ASSET_STATUSES]),
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "a",
              recordKind: "asset",
            }),
            ...(input.kinds?.length ? [inArray(visibleAssets.kind, input.kinds)] : []),
            ...(input.statuses?.length ? [inArray(visibleAssets.status, input.statuses)] : []),
            ...(input.scopes?.length ? [inArray(visibleAssets.scope, input.scopes)] : []),
            ...(input.due === "with_due_action" ? [sql`${nextDueActionAt} is not null`] : []),
            ...(input.due === "without_due_action" ? [sql`${nextDueActionAt} is null`] : []),
            ...(input.review === "needs_review" ? [needsReview] : []),
            ...(input.review === "ready" ? [sql`not ${needsReview}`] : []),
          ),
        )
        .orderBy(...browseOrder(input))
        .limit(input.limit)
        .offset(input.offset);

      return rows.map((row) => ({
        asset: assetSchema.parse(row.asset),
        needsReview: Boolean(row.needsReview),
        nextDueActionAt: row.nextDueActionAt,
      }));
    },

    async countPendingAssetReviews(input) {
      const db = getDb();
      const [row] = await db
        .select({ value: count() })
        .from(countedReviewGroups)
        .where(
          and(
            eq(countedReviewGroups.ownerUserId, input.ownerUserId),
            pendingReviewMembers("counted_review_group"),
          ),
        );
      return row?.value ?? 0;
    },
  };
}
