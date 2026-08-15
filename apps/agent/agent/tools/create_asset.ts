import { createAsset } from "@tendnote/db/queries/assets";
import { assetKindSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toAssetModelRef, toAssetRef } from "../lib/asset-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "What the user calls it, in their own words - 'Kitchen refrigerator', 'Mum's old Corolla'. Never a tidied-up catalogue name.",
    ),
  kind: assetKindSchema.describe(
    "The kind of thing it is: item, appliance, vehicle, subscription, service, or property. Pick from what the user said; ask if it is genuinely unclear.",
  ),
});

/**
 * The explicit half of ADR 0169.
 *
 * The ADR draws one line and it is about *provenance*, not about the record: an
 * active Asset may be created directly "from explicit user intent", while asset-like
 * information Eve inferred - from a receipt, a photo, a warranty, a maintenance
 * note, a promoted action hint - enters review first as a Suggested Asset. Until now
 * only the second half had a tool, so "add my car as an asset" had no path at all:
 * the model either proposed a review card the user had not asked for, or said it had
 * done something it could not do.
 *
 * Explicit means explicit in the current turn, and the description spends its
 * negative half on the two cases that are not: a fact Eve worked out for itself
 * (`propose_asset_memories`), and a turn Global Capture owns (`capture_saved_item`),
 * which has its own review-gated Asset outcome and must not be raced.
 *
 * Scope is deliberately absent from the schema. The shared layer defaults to private
 * and fail-closed, and an Asset's scope is the ceiling for every child record hung on
 * it (ADR 0179) - so a widened Asset is a decision about future memories and evidence
 * too, which is the user's to make in the app rather than Eve's to infer from a
 * sentence containing the word "our".
 */
export default defineTool({
  description:
    "Create an ACTIVE Asset - a thing the user owns or tracks (an appliance, vehicle, subscription, service, item, or property) - when they explicitly ask you to in the current turn ('add my Corolla as an asset', 'start tracking the kitchen fridge'). Search first with `search_assets`: if they already have it, use that asset instead of making a second one. The asset is created private; changing who can see it happens in the app. Do NOT use this for a thing you inferred they own from a receipt, a photo, a note, or anything else you worked out yourself - that is `propose_asset_memories`, which puts it up for review. Do NOT use it on a 'Use Capture' / 'capture this' turn, or a turn with another supported explicit clause: `capture_saved_item` owns those and creates its own review-gated Asset outcome. Do NOT create an asset just to hang a fact on it when the user only told you a detail. Returns the persisted asset reference; name it by its name, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    // No scope, no ownership, no household: the shared layer's private default is the
    // whole point (see the note above). `source: "assistant"` is the honest audit
    // provenance - the user asked, Eve wrote it (ADR 0197).
    const outcome = await withModelSafeStoreErrors(() =>
      createAsset({
        ownerUserId,
        name: input.name,
        kind: input.kind,
        source: "assistant",
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return { asset: toAssetRef(outcome.result) };
  },
  /**
   * No card of its own: a newly created Asset is an empty anchor, and the review
   * group card would be a lie about what just happened. The model confirms it in
   * prose and keeps the id for the follow-up calls that take one.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        created: true,
        asset: toAssetModelRef(output.asset),
        guidance:
          "It exists now, as an empty anchor: nothing is recorded about it yet and it is " +
          "private. Confirm it in one short sentence by name. `assetId` is the handle " +
          "`propose_asset_memories`, `propose_asset_actions`, `edit_asset`, and " +
          "`get_asset_context` take - copy it exactly and never write it in your reply. " +
          "Facts the user tells you about it still go up for review; do not claim to have " +
          "saved a model number, a date, or a price here.",
      },
    };
  },
});
