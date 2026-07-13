import {
  assetLinkSchema,
  assetLinkUpdateSchema,
  assetPersonLinkSchema,
  createAssetLinkSchema,
  createAssetPersonLinkSchema,
} from "@tendnote/domain";
import { and, asc, eq, or } from "drizzle-orm";
import { getDb } from "../../client";
import { assetLinks, assetPersonLinks } from "../../schema";
import type { AssetLinkStore } from "./link-types";

// Shared ordering contract: oldest first, id tiebreak — the in-memory store's
// `byCreatedThenId` mirrors this; keep the two in step.
const linkOrder = [asc(assetLinks.createdAt), asc(assetLinks.id)];
const personLinkOrder = [asc(assetPersonLinks.createdAt), asc(assetPersonLinks.id)];

/**
 * Drizzle-backed Related Asset Link + Asset Person Link store (#202). Creation
 * is idempotent per *owner-scoped* unique triple via each table's unique index —
 * only the creator's own existing row is ever returned, so no caller's write can
 * reach a co-member's link or its review state. The raw list reads are consumed
 * only by the link seam (`links.ts`), which filters every side per record (and
 * dedupes same-shaped triples per caller) before anything reaches a surface.
 * Writes are owner-keyed in the predicate, so a direct store caller can never
 * touch another owner's rows.
 */
export function createDrizzleAssetLinkStore(): AssetLinkStore {
  return {
    async createAssetLink(values) {
      const parsed = createAssetLinkSchema.parse(values);
      const [row] = await getDb()
        .insert(assetLinks)
        .values(parsed)
        .onConflictDoNothing({
          target: [
            assetLinks.ownerUserId,
            assetLinks.fromAssetId,
            assetLinks.toAssetId,
            assetLinks.relation,
          ],
        })
        .returning();
      if (row) {
        return assetLinkSchema.parse(row);
      }
      // The owner's own triple already exists — idempotent creation returns it.
      const [existing] = await getDb()
        .select()
        .from(assetLinks)
        .where(
          and(
            eq(assetLinks.ownerUserId, parsed.ownerUserId),
            eq(assetLinks.fromAssetId, parsed.fromAssetId),
            eq(assetLinks.toAssetId, parsed.toAssetId),
            eq(assetLinks.relation, parsed.relation),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error("Failed to link the assets.");
      }
      return assetLinkSchema.parse(existing);
    },
    async getAssetLink(input) {
      const [row] = await getDb()
        .select()
        .from(assetLinks)
        .where(and(eq(assetLinks.id, input.linkId), eq(assetLinks.ownerUserId, input.ownerUserId)))
        .limit(1);
      return row ? assetLinkSchema.parse(row) : null;
    },
    async updateAssetLink(input) {
      // Defaults-free validation: an absent key stays absent, so a status-only
      // patch can never silently rewrite anything else.
      const patch = assetLinkUpdateSchema.parse(input.patch);
      const [row] = await getDb()
        .update(assetLinks)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(assetLinks.id, input.linkId), eq(assetLinks.ownerUserId, input.ownerUserId)))
        .returning();
      if (!row) {
        throw new Error("Asset link not found.");
      }
      return assetLinkSchema.parse(row);
    },
    async deleteAssetLink(input) {
      await getDb()
        .delete(assetLinks)
        .where(and(eq(assetLinks.id, input.linkId), eq(assetLinks.ownerUserId, input.ownerUserId)));
    },
    async listAssetLinksForAsset(input) {
      const rows = await getDb()
        .select()
        .from(assetLinks)
        .where(
          or(eq(assetLinks.fromAssetId, input.assetId), eq(assetLinks.toAssetId, input.assetId)),
        )
        .orderBy(...linkOrder);
      return rows.map((row) => assetLinkSchema.parse(row));
    },
    async createAssetPersonLink(values) {
      const parsed = createAssetPersonLinkSchema.parse(values);
      const [row] = await getDb()
        .insert(assetPersonLinks)
        .values(parsed)
        .onConflictDoNothing({
          target: [
            assetPersonLinks.ownerUserId,
            assetPersonLinks.assetId,
            assetPersonLinks.personId,
            assetPersonLinks.relation,
          ],
        })
        .returning();
      if (row) {
        return assetPersonLinkSchema.parse(row);
      }
      // The owner's own triple already exists — idempotent creation returns it.
      const [existing] = await getDb()
        .select()
        .from(assetPersonLinks)
        .where(
          and(
            eq(assetPersonLinks.ownerUserId, parsed.ownerUserId),
            eq(assetPersonLinks.assetId, parsed.assetId),
            eq(assetPersonLinks.personId, parsed.personId),
            eq(assetPersonLinks.relation, parsed.relation),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error("Failed to link the person to the asset.");
      }
      return assetPersonLinkSchema.parse(existing);
    },
    async getAssetPersonLink(input) {
      const [row] = await getDb()
        .select()
        .from(assetPersonLinks)
        .where(
          and(
            eq(assetPersonLinks.id, input.linkId),
            eq(assetPersonLinks.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);
      return row ? assetPersonLinkSchema.parse(row) : null;
    },
    async deleteAssetPersonLink(input) {
      await getDb()
        .delete(assetPersonLinks)
        .where(
          and(
            eq(assetPersonLinks.id, input.linkId),
            eq(assetPersonLinks.ownerUserId, input.ownerUserId),
          ),
        );
    },
    async listAssetPersonLinksForAsset(input) {
      const rows = await getDb()
        .select()
        .from(assetPersonLinks)
        .where(eq(assetPersonLinks.assetId, input.assetId))
        .orderBy(...personLinkOrder);
      return rows.map((row) => assetPersonLinkSchema.parse(row));
    },
  };
}
