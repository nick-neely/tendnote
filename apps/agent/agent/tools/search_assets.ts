import { searchAssets } from "@tendnote/db/queries/asset-search";
import {
  assetSearchResultSchema,
  describeAssetMemoryValue,
  searchAssetsSchema,
} from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

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
      .parse(
        await withModelSafeStoreErrors(() =>
          searchAssets({ ...input, includeReviewGated: false, ownerUserId }),
        ),
      );

    return {
      query: input.query,
      results,
      component: {
        type: "asset_search",
        resultCount: results.length,
      },
    };
  },
  /**
   * `toModelOutput` REPLACES the tool result the model sees — the raw output goes only
   * to the chat card. So whatever a follow-up tool needs as input has to be *here*, or
   * the model cannot call that tool at all: this projection is the only place an
   * `assetId` can enter Eve's context, and `get_asset_context` and
   * `propose_asset_actions` both require one. Omitting ids did not hide them from the
   * user — it made the model invent them, and a guessed id is a failed call.
   *
   * Keeping ids out of the *reply* is a different rule, enforced where it belongs:
   * `instructions/base.md` ("Never show raw record ids or UUIDs to the user"). The
   * projection stays honest about what the ids are for.
   */
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        count: output.results.length,
        results: output.results.map((result) => ({
          kind: result.recordKind,
          // The handle every asset follow-up takes. Pass it through verbatim; never
          // retype, shorten, or invent one.
          assetId: result.assetId,
          // Only an Asset Memory id is actionable downstream (`propose_asset_actions`
          // narrows by `assetMemoryIds`), so an asset or evidence row's id is not
          // offered here as one — a wrong id in that slot is a failed call.
          memoryId: result.recordKind === "asset_memory" ? result.recordId : null,
          asset: result.assetName,
          assetKind: result.assetKind,
          label: result.label,
          // The exact stored value, verbatim. This is the answer to "what filter does
          // the fridge need?" — report it as-is and never round or paraphrase it.
          value: describeAssetMemoryValue(result.value) || null,
          snippet: result.snippet,
          matchedBy: result.matchKinds,
          trust: result.trustLevel,
          // A household-native record has no audience anyone chose — it is simply
          // the household's — so the model is given nothing to state one from, the
          // same suppression every rendered Asset surface makes (ADR 0214). The
          // ownership form itself is offered instead, so Eve can still say whose
          // the record is when that is the honest thing to say.
          visibility: result.ownership === "household_native" ? null : result.visibilityLabel,
          visibilityChoice:
            result.ownership === "household_native" ? null : result.visibilityChoice,
          ownership: result.ownership,
        })),
        guidance:
          "`assetId` and `memoryId` are handles for your follow-up tool calls " +
          "(`get_asset_context`, `propose_asset_actions`) — copy them exactly. Never " +
          "write an id in your reply, and never guess one: an asset you did not find " +
          "here has no id you can use.",
      },
    };
  },
});
