import { editAsset } from "@tendnote/db/queries/assets";
import { AssetValidationError, assetKindSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toAssetModelRef, toAssetRef } from "../lib/asset-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  assetId: z
    .uuid()
    .describe(
      "The exact persisted asset id, copied from a prior `search_assets` or `get_asset_context` result. Never guess or retype one; ask which thing they mean if more than one could match.",
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("New name, in the user's own words. Omit to leave the name unchanged."),
  kind: assetKindSchema
    .optional()
    .describe("New kind, when the user says it was filed as the wrong sort of thing."),
});

/**
 * A rename, and nothing that looks like one.
 *
 * The shared seam edits exactly two fields - name and kind - because everything else
 * about an Asset is either a scope decision (the ceiling for every child record, ADR
 * 0179), a lifecycle decision (archive/restore, which stay in the app), or a fact,
 * which is an Asset Memory and goes through review. So this tool is narrow by
 * construction rather than by instruction: there is no field here through which Eve
 * could re-author what the user knows about their fridge.
 *
 * Authority is decided downstream and is not ownership: the owner of a member-owned
 * Asset may re-author it however wide its audience, every active member may re-author
 * the household's own, and an archived Asset is read-only until restored. A refused
 * proof and a missing asset produce the same opaque sentence (ADR 0219).
 *
 * `expectedRevision` is deliberately not exposed. It is a fence for a surface that
 * rendered a form; a model quoting a number from an earlier turn would manufacture
 * conflicts the user never caused, and the shared layer treats its absence as the
 * deliberate replace it is here.
 */
export default defineTool({
  description:
    "Rename an Asset, or correct the kind it was filed under, on the user's explicit instruction in the current turn ('call it the garage fridge instead', 'that's a subscription, not a service'). Requires an assetId you resolved deterministically with `search_assets` or `get_asset_context` - ask which thing they mean rather than guessing. Pass only what changes. This edits what the thing IS CALLED and nothing else: a fact about it (a model number, a filter size, a warranty date, a price) is an Asset Memory and goes through `propose_asset_memories` for review, and you must not use a rename to smuggle one in. Do NOT use this to tidy up names on your own initiative, to batch-rename several things, or to change who can see it - visibility, archiving, and deleting all happen in the app. Returns the updated asset reference; name it by its name, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    // The shared layer rejects an empty edit, but its message is about the record;
    // this one is about the call, and refusing before the write keeps a no-op from
    // reading as a change the user asked for.
    if (input.name === undefined && input.kind === undefined) {
      throw new AssetValidationError("Say what to change about the asset: its name or its kind.");
    }

    const outcome = await withModelSafeStoreErrors(() =>
      editAsset({
        actorUserId: ownerUserId,
        assetId: input.assetId,
        edit: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
        },
        source: "assistant",
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return { asset: toAssetRef(outcome.result) };
  },
  /** A rename has no card - the model says what changed, briefly, in prose. */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        updated: true,
        asset: toAssetModelRef(output.asset),
        guidance:
          "Confirm in one short sentence what it is called now. Nothing else about the " +
          "thing changed: no fact was recorded, and its visibility is untouched.",
      },
    };
  },
});
