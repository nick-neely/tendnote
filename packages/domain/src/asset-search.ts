import { z } from "zod";
import { assetMemoryValueSchema } from "./asset-memories";
import { normalizeAssetNameTokens } from "./asset-review";
import { assetKindSchema, assetOwnershipSchema, assetStatusSchema } from "./assets";
import { privacyScopeSchema, visibilityChoiceSchema } from "./privacy";

/**
 * Unified Asset Search (#196, #204). One search experience over three distinct
 * signals, each with its own typed contract underneath:
 *
 * - `exact`      — lexical text recall over asset names, memory labels/notes, and
 *                  captured evidence text (Postgres full-text, like every other
 *                  exact-recall surface in Tendnote).
 * - `structured` — a typed value match against an Asset Memory's exact value: a
 *                  serial/model/filter size, a receipt amount, or a calendar date.
 * - `semantic`   — vector retrieval for fuzzy intent ("warranties expiring soon",
 *                  "anything for the kitchen fridge").
 *
 * The user never picks a mode; the seam runs all three and fuses them. Results are
 * always *grounded records* — never generated prose — so a search result can always
 * be traced back to the row it came from.
 */
export const assetSearchRecordKindSchema = z.enum(["asset", "asset_memory", "asset_evidence"]);
export type AssetSearchRecordKind = z.infer<typeof assetSearchRecordKindSchema>;

/** Which signal found a record. A record may be found by several at once. */
export const assetSearchMatchKindSchema = z.enum(["structured", "exact", "semantic"]);
export type AssetSearchMatchKind = z.infer<typeof assetSearchMatchKindSchema>;

/**
 * The trust register of a search result — the asset analogue of the relationship
 * trust tiers (ADR 0009). An Asset is an anchor (an identity reference for a
 * thing); a reviewed Asset Memory is a confirmed fact; Asset Evidence is grounding
 * material, not a claim; and a suggested memory is a *proposal* that must never be
 * stated as fact. Eve phrases each register differently.
 */
export const assetSearchTrustLevelSchema = z.enum([
  "asset_anchor",
  "asset_fact",
  "suggested_asset_fact",
  "asset_evidence",
]);
export type AssetSearchTrustLevel = z.infer<typeof assetSearchTrustLevelSchema>;

/**
 * A record-level citation. Asset answers cite the rows they stand on — the memory,
 * its asset, the evidence that grounds it, the source record it was captured from,
 * or the related action — so generated prose can never become the source of truth
 * (#196 user stories 49, 55, 56).
 */
export const assetSearchCitationSchema = z.object({
  kind: z.enum(["asset", "asset_memory", "asset_evidence", "general_action", "source_record"]),
  id: z.string(),
});
export type AssetSearchCitation = z.infer<typeof assetSearchCitationSchema>;

const assetSearchRecordShape = {
  recordKind: assetSearchRecordKindSchema,
  recordId: z.string(),
  // Every result hangs off exactly one Asset — the thing the user is really asking
  // about — so results can be grouped by asset without a second lookup.
  assetId: z.string(),
  assetName: z.string(),
  assetKind: assetKindSchema,
  assetStatus: assetStatusSchema,
  // The *anchor's* ownership form, on every record kind: a memory or a receipt under a
  // household-native Asset is the household's too. It is what lets a surface tell
  // "shared with the household" apart from "is the household's" and stop naming an
  // audience nobody chose (ADR 0214). Defaulted so an older producer stays valid.
  ownership: assetOwnershipSchema.default("member_owned"),
  label: z.string(),
  snippet: z.string(),
  matchedFields: z.array(z.string()).min(1),
  // The typed exact value, when the record carries one (an Asset Memory). This is
  // what makes "what filter does the fridge need?" answerable exactly rather than
  // approximately.
  value: assetMemoryValueSchema.nullable().default(null),
  trustLevel: assetSearchTrustLevelSchema,
  visibilityChoice: visibilityChoiceSchema,
  visibilityLabel: z.string(),
  citations: z.array(assetSearchCitationSchema).min(1),
};

/**
 * The facts the Household Authorization Proof decides one search row on.
 *
 * They are the *record's own*, and that is the whole point of carrying them
 * separately from the display fields above. `ownership` on the record shape is
 * deliberately the anchor Asset's, because a memory under a household-native
 * Asset is the household's and a surface has to say so; but a private receipt
 * hanging off that same household refrigerator is nobody's to see but its
 * owner's, and it has to answer for itself every time it is listed (ADR 0179).
 * One field cannot honestly be both, so there are two.
 *
 * Deliberately absent from {@link assetSearchResultSchema}: policy facts are what
 * a proof is asked, not what a row renders. Nothing downstream of the proof needs
 * them, and a display contract that carried an owner id would be a new place for
 * one to leak.
 */
export const assetSearchAuthorizationFactsSchema = z.object({
  ownerUserId: z.string().min(1),
  scope: privacyScopeSchema,
  householdId: z.string().nullable(),
  ownership: assetOwnershipSchema,
});
export type AssetSearchAuthorizationFacts = z.infer<typeof assetSearchAuthorizationFactsSchema>;

/**
 * One candidate as a single signal found it, before fusion. Stores emit these; the
 * pure merge below turns them into results. `sourceScore` is normalized within its
 * own signal (0..1) so the three signals can be compared on one scale.
 *
 * A candidate is not yet an answer. It carries {@link assetSearchAuthorizationFactsSchema}
 * so the seam can obtain a Household Authorization Proof for every row before any
 * of it is ranked, cited, or shown — the SQL predicate that selected it is a
 * pre-filter and never the decision (ADR 0219).
 */
export const assetSearchCandidateSchema = z.object({
  ...assetSearchRecordShape,
  matchKind: assetSearchMatchKindSchema,
  sourceScore: z.number(),
  authorization: assetSearchAuthorizationFactsSchema,
});
export type AssetSearchCandidate = z.infer<typeof assetSearchCandidateSchema>;

/** A fused, ranked result: one record, every signal that found it. */
export const assetSearchResultSchema = z.object({
  ...assetSearchRecordShape,
  matchKinds: z.array(assetSearchMatchKindSchema).min(1),
  score: z.number(),
});
export type AssetSearchResult = z.infer<typeof assetSearchResultSchema>;

export const searchAssetsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe(
      "What to look for, in the user's own words. One query covers all three signals at " +
        "once: exact text, an exact stored value typed literally (a serial, a model, " +
        '"$1,299.99", "2026-03-14"), and fuzzy intent ("warranties expiring soon").',
    ),
  // Narrow to one Asset — "what do I know about *this* fridge?". A plain string, like
  // every other asset id in the domain: an id the caller does not own simply finds
  // nothing, so format validation would add no safety here.
  assetId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Narrow to one Asset, using an id copied exactly from an earlier `search_assets` " +
        "result - never a guessed one. Omit to search across everything the user tracks.",
    ),
  recordKinds: z
    .array(assetSearchRecordKindSchema)
    .min(1)
    .max(3)
    .optional()
    .describe(
      "Restrict to Assets, reviewed Asset Memories, or captured Asset Evidence. Omit for " +
        "all three, which is usually right.",
    ),
  assetKinds: z
    .array(assetKindSchema)
    .min(1)
    .max(6)
    .optional()
    .describe(
      "Restrict to kinds of thing (appliance, vehicle, subscription, …) when the user's " +
        "question names one. Omit otherwise.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe("Max records to return, best match first. Omit for the ordinary small set."),
  /** Archived assets keep their history but stay out of the way unless asked for. */
  includeArchived: z
    .boolean()
    .default(false)
    .describe(
      "Include Assets the user archived. Leave false unless they explicitly ask about " +
        "something they no longer have.",
    ),
  /**
   * Owner-only review context: when true, the caller's own `suggested` Assets and
   * Asset Memories may be found so a review surface can look up grounded proposals.
   * A proposal stays owner-only regardless — never scope-visible to a household
   * member, and never model-facing (mirrors General Actions, ADRs 0151–0153).
   */
  includeReviewGated: z.boolean().default(false),
});

export type SearchAssetsInput = z.input<typeof searchAssetsSchema>;
export type ParsedSearchAssetsInput = z.output<typeof searchAssetsSchema>;

/**
 * What a raw query actually asks for, resolved deterministically before any store
 * is touched. Pure and testable: the structured tiers of Asset Search are only as
 * good as this parse, and a search seam is a trust surface — it must be explainable
 * and repeatable, never model-inferred.
 */
export type AssetSearchQueryPlan = {
  /** The raw trimmed query, handed to lexical full-text search as-is. */
  text: string;
  /** Alias-canonical, stopword-free, singularized tokens — "kitchen fridge" → refrigerator. */
  tokens: string[];
  /** Serial numbers, model names, filter sizes: exact tokens worth matching literally. */
  identifiers: string[];
  /** A receipt/renewal amount the user typed ("$1,299.99", "450 EUR"). */
  amount: { amount: number; currency: string } | null;
  /** A calendar date the user typed ("2026-03-14"). Asset facts are day-precise. */
  date: string | null;
};

const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;
// A currency marker is required — a bare number is a model/serial far more often
// than it is money ("filter 4396508"). `$450`, `450 USD`, and `USD 450` all read as
// money; `4396508` does not.
const DOLLAR_AMOUNT_PATTERN = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/;
const TRAILING_CODE_AMOUNT_PATTERN = /\b(\d[\d,]*(?:\.\d{1,2})?)\s*([A-Z]{3})\b/;
const LEADING_CODE_AMOUNT_PATTERN = /\b([A-Z]{3})\s*(\d[\d,]*(?:\.\d{1,2})?)\b/;

function toAmount(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/**
 * Reads the structured intent out of a free-text query: an ISO date, a currency
 * amount, identifier-like tokens, and the normalized name tokens. Each recognized
 * span is *consumed* before the next pass, so "$450 on 2026-03-14" yields an amount
 * and a date and no bogus "450"/"2026" identifiers.
 */
export function parseAssetSearchQuery(query: string): AssetSearchQueryPlan {
  const text = query.trim().replace(/\s+/g, " ");

  let residual = text;
  const dateMatch = residual.match(ISO_DATE_PATTERN);
  const date = dateMatch?.[0] ?? null;
  if (dateMatch) {
    residual = residual.replace(dateMatch[0], " ");
  }

  let amount: AssetSearchQueryPlan["amount"] = null;
  const dollar = residual.match(DOLLAR_AMOUNT_PATTERN);
  const trailing = residual.match(TRAILING_CODE_AMOUNT_PATTERN);
  const leading = residual.match(LEADING_CODE_AMOUNT_PATTERN);
  if (dollar?.[1]) {
    amount = { amount: toAmount(dollar[1]), currency: "USD" };
    residual = residual.replace(dollar[0], " ");
  } else if (trailing?.[1] && trailing[2]) {
    amount = { amount: toAmount(trailing[1]), currency: trailing[2].toUpperCase() };
    residual = residual.replace(trailing[0], " ");
  } else if (leading?.[1] && leading[2]) {
    amount = { amount: toAmount(leading[2]), currency: leading[1].toUpperCase() };
    residual = residual.replace(leading[0], " ");
  }

  return {
    text,
    tokens: [...normalizeAssetNameTokens(residual)].sort(),
    identifiers: extractIdentifiers(residual, text),
    amount,
    date,
  };
}

/**
 * Identifier-like tokens: anything carrying a digit ("4396508"), plus all-caps tokens
 * ("RPWFE", "MWF") — the shape serial numbers, model names, and filter sizes actually
 * take.
 *
 * The all-caps rule is suppressed for a *multi-word* query typed entirely in caps,
 * where capitalization carries no signal and every word would qualify. A single-word
 * query is exempt from that suppression, because pasting a bare model number is the
 * single most common structured search there is — "RPWFE" must read as an identifier,
 * not as a shouted noun.
 */
function extractIdentifiers(residual: string, fullQuery: string): string[] {
  const words = fullQuery.split(/[^A-Za-z0-9-]+/).filter((word) => /[A-Za-z]/.test(word));
  const capsAreMeaningful = /[a-z]/.test(fullQuery) || words.length <= 1;

  const identifiers = residual
    .split(/[^A-Za-z0-9-]+/)
    .filter((token) => token.length >= 3)
    .filter((token) => {
      const hasDigit = /\d/.test(token);
      const isAllCaps = capsAreMeaningful && /^[A-Z0-9-]+$/.test(token) && /[A-Z]/.test(token);

      return hasDigit || isAllCaps;
    })
    .map((token) => token.toUpperCase());

  return [...new Set(identifiers)].sort();
}

/**
 * The Postgres `tsquery` text for a plan's lexical tier, or null when the query has
 * no searchable term at all (e.g. just an amount).
 *
 * Two decisions live here. First, the terms are the *normalized* ones — alias-folded
 * and singularized — so a stored "Refrigerator" is reachable from a typed "fridge",
 * which a raw `websearch_to_tsquery` over the `simple` dictionary could never do.
 * Second, terms are OR-ed rather than AND-ed: "kitchen fridge" must still find the
 * refrigerator that was never labeled "kitchen". Precision is not lost, because
 * `ts_rank_cd` still ranks a row matching both terms above a row matching one.
 *
 * Terms are reduced to bare alphanumerics, so the result is always a well-formed
 * tsquery and can never be a syntax error or an injection vector.
 */
export function buildAssetSearchTsQuery(plan: AssetSearchQueryPlan): string | null {
  const terms = [...plan.tokens, ...plan.identifiers]
    .map((term) => term.toLowerCase().replace(/[^a-z0-9]+/g, ""))
    .filter((term) => term.length > 0);

  const unique = [...new Set(terms)].sort();

  return unique.length > 0 ? unique.join(" | ") : null;
}

/**
 * The relevance floor the semantic tier must clear, and the most rows it may
 * contribute — the *retrieval-side* bound on the weakest signal.
 *
 * Cosine similarity over a warm index is never zero: every embedded record is related
 * to every query by some small amount, so the `similarity > 0` this replaces admitted
 * the entire corpus and stamped all of it "Related". The floor is the point below which
 * a hit is ambient similarity rather than a claim worth making; the cap keeps one broad
 * meaning-shaped query from returning an unbounded tier.
 *
 * These bound the tier; they do not decide relevance on their own — that is
 * {@link passesSemanticGate}, which asks the question a threshold cannot: *related to
 * what?*
 *
 * Shared by both stores so the SQL and the in-memory twin can never disagree about
 * what reaches the fusion.
 */
export const ASSET_SEMANTIC_SIMILARITY_FLOOR = 0.45;
export const ASSET_SEMANTIC_TIER_LIMIT = 10;

/**
 * How much each signal is trusted when the three disagree. A typed value match is
 * the most precise thing Asset Search can say ("the filter *is* RPWFE"); lexical
 * text is next; a meaning-only hit is the weakest claim and must never outrank an
 * exact one.
 */
const MATCH_KIND_WEIGHTS: Record<AssetSearchMatchKind, number> = {
  structured: 1,
  exact: 0.8,
  semantic: 0.6,
};

/** Reported strongest-signal-first, and the order the UI badges them in. */
const MATCH_KIND_PRECISION: readonly AssetSearchMatchKind[] = ["structured", "exact", "semantic"];

/**
 * Independent signals agreeing on the same record is itself evidence. Small on
 * purpose: it breaks near-ties in favor of corroborated records without ever
 * letting two weak signals outrank one precise one.
 */
const MULTI_SIGNAL_BONUS = 0.15;

/** A record found only by meaning — no exact text hit, no typed-value hit. */
function isMeaningOnly(kinds: ReadonlySet<AssetSearchMatchKind>): boolean {
  return kinds.has("semantic") && !kinds.has("exact") && !kinds.has("structured");
}

/**
 * The Assets a query actually landed on: the anchors carrying at least one record the
 * user's own words found — exactly, or by its typed value.
 */
function anchorsFoundExactly(
  merged: Iterable<{ best: AssetSearchCandidate; kinds: Set<AssetSearchMatchKind> }>,
): Set<string> {
  const anchors = new Set<string>();
  for (const { best, kinds } of merged) {
    if (!isMeaningOnly(kinds)) {
      anchors.add(best.assetId);
    }
  }
  return anchors;
}

/**
 * The relevance gate on the weakest signal, and the answer to "why is my whole asset
 * list showing up stamped *Related*?".
 *
 * A relevance floor alone cannot carry this. Cosine similarity is a *continuum*: with a
 * warm index every record is somewhat like every query, so wherever the floor is set,
 * a broad query still drags in records about things the user never asked about — and a
 * search result that claims "Related" about an unrelated thing corrodes the trust
 * register that is the whole point of this surface. Revisited after the offline fixture
 * gained signed, distributed embeddings (#209): the floor is now locally meaningful,
 * but the structural gate remains because broad-query relevance and production-model
 * drift still cannot be expressed safely by one universal cosine threshold.
 *
 * So the tier is gated *structurally*, on the one relationship every Asset Search
 * candidate already carries: the Asset it hangs off.
 *
 * **A meaning-only record surfaces when its Asset was itself found by the user's own
 * words — or when nothing was.**
 *
 * That keeps the flagship fuzzy case whole: "anything for the kitchen fridge" finds the
 * refrigerator by name, so the refrigerator's filter size — which matches no word typed —
 * still rides in on meaning, which is exactly what the semantic tier is *for*. And it
 * ends the noise: typing "boiler" can no longer return the fridge's purchase price
 * merely because a vector said the two were 0.6 alike. When the query matches nothing
 * exactly at all, the tier opens fully and meaning is all there is — an honest fallback,
 * and the results say so ("Close in meaning — nothing here matched your words exactly").
 *
 * Corroboration is untouched: a record found exactly *and* semantically was never
 * meaning-only, and keeps both signals and its multi-signal bonus.
 */
function passesSemanticGate(
  kinds: ReadonlySet<AssetSearchMatchKind>,
  assetId: string,
  exactAnchors: ReadonlySet<string>,
): boolean {
  if (!isMeaningOnly(kinds) || exactAnchors.size === 0) {
    return true;
  }
  return exactAnchors.has(assetId);
}

/**
 * Fuses the three signals into one ranked, deduplicated result list — the whole
 * point of "one Asset Search experience" (#196 user story 51). A record found by
 * several signals collapses into a single result that reports all of them, scored
 * by its strongest signal plus a corroboration bonus.
 *
 * Pure and deterministic: the same candidates always produce the same order (score,
 * then label, then id), so a search result is explainable and repeatable. The limit
 * is applied *after* fusion, never before — otherwise a record about to be promoted
 * by a second signal could be cut before that signal was counted. The semantic gate
 * (see {@link passesSemanticGate}) likewise runs after the merge, so a record that a
 * second signal was about to corroborate is never cut for being meaning-only.
 */
export function mergeAssetSearchResults(input: {
  candidates: readonly AssetSearchCandidate[];
  limit: number;
}): AssetSearchResult[] {
  const merged = new Map<
    string,
    {
      best: AssetSearchCandidate;
      bestScore: number;
      kinds: Set<AssetSearchMatchKind>;
      fields: Set<string>;
    }
  >();

  for (const candidate of input.candidates) {
    const key = `${candidate.recordKind}:${candidate.recordId}`;
    const weighted = MATCH_KIND_WEIGHTS[candidate.matchKind] * candidate.sourceScore;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        best: candidate,
        bestScore: weighted,
        kinds: new Set([candidate.matchKind]),
        fields: new Set(candidate.matchedFields),
      });
      continue;
    }

    existing.kinds.add(candidate.matchKind);
    for (const field of candidate.matchedFields) {
      existing.fields.add(field);
    }
    // The strongest signal owns the representative row, so the snippet and value the
    // user reads come from the match that actually justified the ranking.
    if (weighted > existing.bestScore) {
      existing.best = candidate;
      existing.bestScore = weighted;
    }
  }

  const exactAnchors = anchorsFoundExactly(merged.values());

  return [...merged.values()]
    .filter(({ best, kinds }) => passesSemanticGate(kinds, best.assetId, exactAnchors))
    .map(({ best, bestScore, kinds, fields }) => ({
      recordKind: best.recordKind,
      recordId: best.recordId,
      assetId: best.assetId,
      assetName: best.assetName,
      assetKind: best.assetKind,
      assetStatus: best.assetStatus,
      ownership: best.ownership,
      label: best.label,
      snippet: best.snippet,
      matchedFields: [...fields].sort(),
      matchKinds: MATCH_KIND_PRECISION.filter((kind) => kinds.has(kind)),
      score: bestScore + MULTI_SIGNAL_BONUS * (kinds.size - 1),
      value: best.value,
      trustLevel: best.trustLevel,
      visibilityChoice: best.visibilityChoice,
      visibilityLabel: best.visibilityLabel,
      citations: best.citations,
    }))
    .sort(
      (a, b) =>
        b.score - a.score || a.label.localeCompare(b.label) || a.recordId.localeCompare(b.recordId),
    )
    .slice(0, input.limit);
}
