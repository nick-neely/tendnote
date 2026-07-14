import { searchAssets } from "@tendnote/db/queries/asset-search";
import {
  assetSearchResultSchema,
  describeAssetMemoryValue,
  searchAssetsSchema,
} from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Unified Asset Search over the things the user owns and tracks — appliances, vehicles, subscriptions, services, household items — and everything recorded about them: reviewed Asset Memories (model numbers, filter sizes, serial numbers, purchase/warranty/renewal dates, receipt amounts, maintenance notes) and captured Asset Evidence (receipts, manuals, warranties, photos). One search covers all three signals at once, so you never pick a mode: exact text, exact structured values (type a serial, model, filter size, amount like $1,299.99, or an ISO date like 2026-03-14 and it matches the stored value exactly), and fuzzy intent ('warranties expiring soon', 'anything for the kitchen fridge'). Use this for any question about a thing the user owns — 'what filter does the fridge need?', 'when does the car warranty end?', 'what did I pay for the dishwasher?'. Returns grounded, scope-filtered records — never a generated answer. Each result carries the exact stored value, the trust register (an Asset is an anchor; a reviewed Asset Memory is a confirmed fact; Asset Evidence is grounding material, not a claim), the signals that found it, and its visibility label. Answer only from these records and say the exact value; never guess or round a model number, serial, filter size, price, or date. Do not use this for people (`search_people`), relationship context (`search_relationship_context`, `search_semantic_context`), or to load one known asset's full profile (`get_asset_context`).",
  // The review-gated flag (owner-only access to un-accepted Suggested Assets and Asset
  // Memories) is a deliberate caller decision, not a model-facing toggle, so it is
  // omitted here and defaults to false: search never surfaces un-reviewed proposals.
  inputSchema: searchAssetsSchema.omit({ includeReviewGated: true }),
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const results = assetSearchResultSchema
      .array()
      // Pin includeReviewGated to false *after* spreading input: review context is an
      // owner-only caller decision, never model-forwarded, so a hallucinated flag can
      // never surface an un-reviewed proposal as if it were a fact.
      .parse(await searchAssets({ ...input, includeReviewGated: false, ownerUserId }));

    return {
      query: input.query,
      results,
      component: {
        type: "asset_search",
        resultCount: results.length,
      },
    };
  },
  // Record ids are for the chat component and your follow-up tool calls, not your
  // reply. Strip them from the model's view; the channel still gets the full
  // structured output for rendering.
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        count: output.results.length,
        results: output.results.map((result) => ({
          kind: result.recordKind,
          asset: result.assetName,
          assetKind: result.assetKind,
          label: result.label,
          // The exact stored value, verbatim. This is the answer to "what filter does
          // the fridge need?" — report it as-is and never round or paraphrase it.
          value: describeAssetMemoryValue(result.value) || null,
          snippet: result.snippet,
          matchedBy: result.matchKinds,
          trust: result.trustLevel,
          visibility: result.visibilityLabel,
          visibilityChoice: result.visibilityChoice,
        })),
      },
    };
  },
});
