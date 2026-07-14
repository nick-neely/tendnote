import { z } from "zod";

/**
 * An Asset Review Group (#198): one review unit in the shared Review Queue,
 * anchoring everything inferred from a single source context — a Suggested Asset
 * (or an existing Asset gaining details), its Suggested Asset Memories, and the
 * duplicate-review prompt — so a source is reviewed together instead of as
 * scattered rows. `assetId` is the group's anchor: the suggested asset row while
 * the proposal is pending, or the existing/linked Asset the details belong to.
 * Later slices (#199, #200) attach evidence and suggested actions to the same
 * group additively.
 */
export const assetReviewGroupSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  assetId: z.string(),
  // The source record grounding the group's suggestions (ADR 0151).
  sourceRecordId: z.string().nullable().default(null),
  createdAt: z.date(),
});

export const createAssetReviewGroupSchema = assetReviewGroupSchema.omit({
  id: true,
  createdAt: true,
});

export type AssetReviewGroup = z.infer<typeof assetReviewGroupSchema>;
export type CreateAssetReviewGroupInput = z.input<typeof createAssetReviewGroupSchema>;

// ---------------------------------------------------------------------------
// Duplicate matching
// ---------------------------------------------------------------------------

// Words too generic to signal a duplicate on their own.
const STOPWORDS = new Set(["the", "a", "an", "my", "our", "new", "old", "for", "of", "and"]);

// A tiny alias table for the everyday contractions people actually use when
// naming the same thing twice ("fridge filter" vs "refrigerator water filter").
// Deliberately small and deterministic — no fuzzy embeddings in the review gate.
const TOKEN_ALIASES: Record<string, string> = {
  fridge: "refrigerator",
  tv: "television",
  ac: "airconditioner",
  auto: "car",
};

/** Naive singular form so "filters" and "filter" compare equal. */
function singularize(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

/**
 * Normalizes an asset name to its comparable token set: lowercased, punctuation
 * stripped, stopwords dropped, aliases canonicalized, plurals folded.
 */
export function normalizeAssetNameTokens(name: string): Set<string> {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .map(singularize);
  return new Set(tokens);
}

// A candidate must cover most of the shorter name's tokens: strictly more than
// half, so a single weak shared word ("water") never flags a duplicate, while
// "fridge filter" fully covers "refrigerator water filter"'s overlap.
const DUPLICATE_SCORE_THRESHOLD = 0.6;
const DUPLICATE_CANDIDATE_LIMIT = 3;

/**
 * Finds existing Assets a proposed name likely duplicates (#198) — the
 * deterministic gate behind the "link to an existing Asset?" review prompt.
 * Token-overlap scoring against the names the caller may already see; returns at
 * most three, best match first. Deterministic on purpose: duplicate review is a
 * trust surface, so it must be explainable and repeatable, never model-inferred.
 */
export function findAssetDuplicateCandidates<T extends { id: string; name: string }>(input: {
  name: string;
  assets: readonly T[];
  /** The proposal's own asset row, excluded so it never flags itself. */
  excludeAssetId?: string;
}): T[] {
  const proposed = normalizeAssetNameTokens(input.name);
  if (proposed.size === 0) {
    return [];
  }

  const scored = input.assets
    .filter((asset) => asset.id !== input.excludeAssetId)
    .map((asset) => {
      const existing = normalizeAssetNameTokens(asset.name);
      if (existing.size === 0) {
        return { asset, score: 0 };
      }
      let overlap = 0;
      for (const token of proposed) {
        if (existing.has(token)) {
          overlap += 1;
        }
      }
      return { asset, score: overlap / Math.min(proposed.size, existing.size) };
    })
    .filter((candidate) => candidate.score >= DUPLICATE_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name));

  return scored.slice(0, DUPLICATE_CANDIDATE_LIMIT).map((candidate) => candidate.asset);
}
