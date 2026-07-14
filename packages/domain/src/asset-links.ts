import { z } from "zod";
import { AssetValidationError } from "./assets";

/**
 * Lightweight Related Asset Links and Asset Person Links (#202): the small,
 * fixed context vocabulary Asset Profiles remember relationships with — a filter
 * fits a refrigerator, a neighbor borrowed the pressure washer. Deliberately not
 * a graph: no hierarchies, inherited permissions, rollups, or custom relation
 * taxonomies (#196 deferred scope). A link is context, not ownership — it never
 * changes either record's visibility, and each side is scope-filtered
 * independently on display, like the General Action ↔ Asset bridge (ADR 0156).
 */

/**
 * The fixed Related Asset Link relation set (#202): how one asset relates to
 * another, read subject-first — "the filter *fits* the refrigerator" is a link
 * from the filter to the refrigerator. Fixed on purpose, like Asset Kinds: no
 * user-managed relation taxonomy.
 */
export const assetLinkRelationSchema = z.enum([
  "fits",
  "uses",
  "part_of",
  "replaces",
  "covers",
  "stored_with",
]);
export type AssetLinkRelation = z.infer<typeof assetLinkRelationSchema>;

/**
 * The canonical relation labels for pickers and link rows, phrased as the verb
 * between the two names ("Filter *fits* Refrigerator"), so every surface reads a
 * link as the same plain sentence.
 */
export const ASSET_LINK_RELATION_OPTIONS: ReadonlyArray<{
  relation: AssetLinkRelation;
  label: string;
}> = [
  { relation: "fits", label: "fits" },
  { relation: "uses", label: "uses" },
  { relation: "part_of", label: "part of" },
  { relation: "replaces", label: "replaces" },
  { relation: "covers", label: "covers" },
  { relation: "stored_with", label: "stored with" },
];

export function assetLinkRelationLabel(relation: AssetLinkRelation): string {
  return (
    ASSET_LINK_RELATION_OPTIONS.find((option) => option.relation === relation)?.label ?? relation
  );
}

/**
 * A Related Asset Link's lifecycle, mirroring Asset Memories (#198): born
 * `suggested` when inferred — review-gated, owner-only, never silently part of
 * the asset graph — and `active` when explicitly created or accepted in review;
 * `dismissed` is the resolved husk of a rejected suggestion. Acceptance flips
 * the same row in place, so the suggested and durable paths never fork.
 */
export const assetLinkStatusSchema = z.enum(["suggested", "active", "dismissed"]);
export type AssetLinkStatus = z.infer<typeof assetLinkStatusSchema>;

/**
 * A lightweight Related Asset Link (#202): subject (`fromAssetId`) → relation →
 * object (`toAssetId`), owned by whoever created it. Defaults fail closed — an
 * unstated status is `suggested`, never durable truth.
 */
export const assetLinkSchema = z.object({
  id: z.string(),
  // The link's creator. Either linked asset may belong to a household co-member;
  // the link itself carries no scope — it surfaces only where both sides do.
  ownerUserId: z.string(),
  fromAssetId: z.string(),
  toAssetId: z.string(),
  relation: assetLinkRelationSchema,
  status: assetLinkStatusSchema.default("suggested"),
  // Grounding for an inferred link (ADR 0151); null for explicit user creates.
  sourceRecordId: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createAssetLinkSchema = assetLinkSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AssetLink = z.infer<typeof assetLinkSchema>;
export type CreateAssetLinkInput = z.input<typeof createAssetLinkSchema>;

/**
 * The bounded, defaults-free update a persisted link accepts: review resolves a
 * link's status in place; everything else — the pair, the relation, the owner —
 * is immutable. Remove and re-add to change what a link says.
 */
export const assetLinkUpdateSchema = z.object({ status: assetLinkStatusSchema }).partial();
export type AssetLinkUpdate = z.infer<typeof assetLinkUpdateSchema>;

/** Guards that a link connects two distinct assets — an asset never links to itself. */
export function requireLinkableAssetPair(fromAssetId: string, toAssetId: string): void {
  if (fromAssetId === toAssetId) {
    throw new AssetValidationError("An asset can't be linked to itself.");
  }
}

/**
 * Which end of a link an Asset Profile is reading it from: `outgoing` from the
 * subject side ("this fits the refrigerator"), `incoming` from the object side
 * ("the filter fits this"). Null when the link does not touch the asset — the
 * caller should treat that row as not theirs to show.
 */
export function resolveAssetLinkPerspective(
  link: { fromAssetId: string; toAssetId: string },
  perspectiveAssetId: string,
): { otherAssetId: string; direction: "outgoing" | "incoming" } | null {
  if (link.fromAssetId === perspectiveAssetId) {
    return { otherAssetId: link.toAssetId, direction: "outgoing" };
  }
  if (link.toAssetId === perspectiveAssetId) {
    return { otherAssetId: link.fromAssetId, direction: "incoming" };
  }
  return null;
}

/**
 * The fixed Asset Person Link relation set (#202): the contextual ways a person
 * relates to an asset — recommended, borrowed, uses, stores, services, knows
 * about (#196). Context only: a person link never makes someone an owner and
 * never widens who can see the asset.
 */
export const assetPersonRelationSchema = z.enum([
  "recommended",
  "borrowed",
  "uses",
  "stores",
  "services",
  "knows_about",
]);
export type AssetPersonRelation = z.infer<typeof assetPersonRelationSchema>;

/**
 * The canonical person-relation labels, phrased after the person's name
 * ("Marcus *borrowed it*"), so link rows read as plain sentences.
 */
export const ASSET_PERSON_RELATION_OPTIONS: ReadonlyArray<{
  relation: AssetPersonRelation;
  label: string;
}> = [
  { relation: "recommended", label: "recommended it" },
  { relation: "borrowed", label: "borrowed it" },
  { relation: "uses", label: "uses it" },
  { relation: "stores", label: "stores it" },
  { relation: "services", label: "services it" },
  { relation: "knows_about", label: "knows about it" },
];

export function assetPersonRelationLabel(relation: AssetPersonRelation): string {
  return (
    ASSET_PERSON_RELATION_OPTIONS.find((option) => option.relation === relation)?.label ?? relation
  );
}

/**
 * A lightweight Asset Person Link (#202): person → contextual relation → asset.
 * People are owner-private records, so a person link is visible only to its
 * owner; it carries no scope and never affects the asset's visibility.
 */
export const assetPersonLinkSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  assetId: z.string(),
  personId: z.string(),
  relation: assetPersonRelationSchema,
  createdAt: z.date(),
});

export const createAssetPersonLinkSchema = assetPersonLinkSchema.omit({
  id: true,
  createdAt: true,
});

export type AssetPersonLink = z.infer<typeof assetPersonLinkSchema>;
export type CreateAssetPersonLinkInput = z.input<typeof createAssetPersonLinkSchema>;
