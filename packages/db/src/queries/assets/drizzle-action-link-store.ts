import { createGeneralActionAssetLinkSchema, generalActionAssetLinkSchema } from "@tendnote/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../client";
import { generalActionAssets } from "../../schema";
import type { GeneralActionAssetLinkStore } from "./review-types";

// Shared ordering contract: oldest first, id tiebreak — the in-memory store's
// `byCreatedThenId` mirrors this; keep the two in step.
const linkOrder = [asc(generalActionAssets.createdAt), asc(generalActionAssets.id)];

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
    async repointGeneralActionAssetLinks(input) {
      const db = getDb();
      const fromRows = await db
        .select()
        .from(generalActionAssets)
        .where(
          and(
            eq(generalActionAssets.ownerUserId, input.ownerUserId),
            eq(generalActionAssets.assetId, input.fromAssetId),
          ),
        )
        .orderBy(...linkOrder);

      let repointed = 0;
      for (const row of fromRows) {
        const [collision] = await db
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
          await db.delete(generalActionAssets).where(eq(generalActionAssets.id, row.id));
          continue;
        }
        await db
          .update(generalActionAssets)
          .set({ assetId: input.toAssetId })
          .where(eq(generalActionAssets.id, row.id));
        repointed += 1;
      }
      return repointed;
    },
    async deleteGeneralActionAssetLink(input) {
      await getDb()
        .delete(generalActionAssets)
        .where(
          and(
            eq(generalActionAssets.id, input.linkId),
            eq(generalActionAssets.ownerUserId, input.ownerUserId),
          ),
        );
    },
  };
}
