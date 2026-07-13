import { randomUUID } from "node:crypto";
import {
  type AssetLink,
  type AssetPersonLink,
  assetLinkSchema,
  createAssetLinkSchema,
  createAssetPersonLinkSchema,
} from "@tendnote/domain";
import type { AssetLinkStore } from "./link-types";

/** Oldest first, id tiebreak — the shared ordering contract with drizzle. */
function byCreatedThenId(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/**
 * Minimal Related Asset Link + Asset Person Link store over maps (#202),
 * mirroring the drizzle link store's behavior — idempotent creation per unique
 * triple, oldest-first reads — so the link seam tests are authoritative for both.
 */
export function createInMemoryAssetLinkStore(): AssetLinkStore {
  const links = new Map<string, AssetLink>();
  const personLinks = new Map<string, AssetPersonLink>();

  return {
    async createAssetLink(values) {
      const parsed = createAssetLinkSchema.parse(values);
      // Owner-scoped idempotency: only the creator's own existing row is ever
      // returned — a co-member's same-shaped link is a different record.
      for (const link of links.values()) {
        if (
          link.ownerUserId === parsed.ownerUserId &&
          link.fromAssetId === parsed.fromAssetId &&
          link.toAssetId === parsed.toAssetId &&
          link.relation === parsed.relation
        ) {
          return link;
        }
      }
      const now = new Date();
      const link: AssetLink = { ...parsed, id: randomUUID(), createdAt: now, updatedAt: now };
      links.set(link.id, link);
      return link;
    },
    async getAssetLink(input) {
      const link = links.get(input.linkId);
      if (!link || link.ownerUserId !== input.ownerUserId) {
        return null;
      }
      return link;
    },
    async updateAssetLink(input) {
      const link = links.get(input.linkId);
      if (!link || link.ownerUserId !== input.ownerUserId) {
        throw new Error("Asset link not found.");
      }
      // Re-validate the merged record so constraints hold for direct store callers.
      const updated = assetLinkSchema.parse({ ...link, ...input.patch, updatedAt: new Date() });
      links.set(updated.id, updated);
      return updated;
    },
    async deleteAssetLink(input) {
      const link = links.get(input.linkId);
      if (link && link.ownerUserId === input.ownerUserId) {
        links.delete(input.linkId);
      }
    },
    async listAssetLinksForAsset(input) {
      return [...links.values()]
        .filter((link) => link.fromAssetId === input.assetId || link.toAssetId === input.assetId)
        .sort(byCreatedThenId);
    },
    async createAssetPersonLink(values) {
      const parsed = createAssetPersonLinkSchema.parse(values);
      // Owner-scoped idempotency, same rule as asset links.
      for (const link of personLinks.values()) {
        if (
          link.ownerUserId === parsed.ownerUserId &&
          link.assetId === parsed.assetId &&
          link.personId === parsed.personId &&
          link.relation === parsed.relation
        ) {
          return link;
        }
      }
      const link: AssetPersonLink = { ...parsed, id: randomUUID(), createdAt: new Date() };
      personLinks.set(link.id, link);
      return link;
    },
    async getAssetPersonLink(input) {
      const link = personLinks.get(input.linkId);
      if (!link || link.ownerUserId !== input.ownerUserId) {
        return null;
      }
      return link;
    },
    async deleteAssetPersonLink(input) {
      const link = personLinks.get(input.linkId);
      if (link && link.ownerUserId === input.ownerUserId) {
        personLinks.delete(input.linkId);
      }
    },
    async listAssetPersonLinksForAsset(input) {
      return [...personLinks.values()]
        .filter((link) => link.assetId === input.assetId)
        .sort(byCreatedThenId);
    },
  };
}
