import { proposeAssetMemoryActions } from "@tendnote/db/queries/assets";
import { MAX_ASSET_ACTION_PROPOSALS } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  assetId: z
    .uuid()
    .describe(
      "The Asset whose reviewed details should propose reminders — copied exactly from a `search_assets` or `get_asset_context` result, or the profile the user is looking at, never guessed.",
    ),
  assetMemoryIds: z
    .array(z.uuid())
    .optional()
    .describe(
      "Optionally narrow the pass to specific reviewed details (e.g. only the warranty). Omit to consider every dated or recurring detail on the asset.",
    ),
});

/**
 * Asset-linked reminder proposals (#203): thin over the owner-scoped proposal seam,
 * which reads the Asset's *reviewed* memories — warranty dates, renewal dates,
 * maintenance and replacement intervals — and proposes Suggested General Actions.
 *
 * This tool cannot create an active action, by construction rather than by instruction:
 * the seam only ever writes `suggested` rows, and promotion is the user's own
 * accept. That is the #196 boundary — Eve may propose asset-linked actions, but it is
 * not an autonomous asset manager, and a durable reminder always passes through review.
 * An explicit "add a reminder to replace the filter every 6 months" is a different tool
 * (`create_general_action`), because that is the user's own instruction, not Eve's
 * inference.
 *
 * Idempotent and capped in the seam: a detail that already proposed an action — however
 * the user resolved it — is never re-proposed, so asking twice cannot nag.
 */
export default defineTool({
  description: `Propose SUGGESTED General Actions from an Asset's reviewed details — warranty expiries, renewal dates, maintenance and replacement intervals. ANY question about what an asset should remind the user about is this tool ('should I set a reminder for the fridge filter?', 'what reminders should the fridge have?', 'anything I should be reminded about for the car?', 'remind me about the warranty'), as is the moment right after they add a dated or recurring detail. Reading the asset's details with get_asset_context does NOT answer that question — this tool is what decides, because it alone knows which details already proposed a reminder. Proposes at most ${MAX_ASSET_ACTION_PROPOSALS} per pass, and NEVER creates an active action: each proposal is a review card the user accepts or dismisses. A detail that already proposed an action is not proposed again, so calling this twice is safe and silent. Do NOT use it to add a reminder the user explicitly asked for — that is create_general_action. Returns the proposed actions; refer to them by title, never raw ids.`,
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      proposeAssetMemoryActions({
        actorUserId: ownerUserId,
        assetId: input.assetId,
        assetMemoryIds: input.assetMemoryIds,
        // Provenance: this pass came from the assistant, not a click on the profile.
        source: "assistant",
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const result = outcome.result;

    return {
      found: true as const,
      proposed: result.proposed.map((proposal) => ({
        action: toGeneralActionRef(proposal.action),
      })),
      // Why an empty pass was empty. The seam distinguishes the two causes precisely so a
      // surface never has to guess between them (`action-proposal-types.ts`), and the model
      // is the surface that guesses worst: told only "nothing to propose", it invented a
      // reason ("there's no date recorded on the interval") and offered to fix the problem
      // it had made up. Carry the distinction through.
      alreadySpokenFor: result.alreadySpokenFor,
      asset: { id: result.asset.id, name: result.asset.name },
    };
  },
  // The chat renders each proposal as an interactive review card with Accept/Dismiss, so the
  // model offers them in one sentence and defers the detail. An empty pass is a real, calm
  // answer — and which calm answer it is depends on why it was empty.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        asset: output.asset.name,
        proposed: output.proposed.map((entry) => toGeneralActionModelRef(entry.action)),
        // A pass that proposes nothing renders nothing, so the no-reprint rule has
        // to stay off in that case: an empty pass is answered entirely in words.
        rendered:
          output.proposed.length > 0
            ? "Each proposal is shown to the user as its own review card."
            : "Nothing is shown to the user: this pass proposed no action, so there is no card.",
        guidance: resolveGuidance(output),
      },
    };
  },
});

function resolveGuidance(output: { proposed: unknown[]; alreadySpokenFor: number }): string {
  if (output.proposed.length > 0) {
    return "These are TENTATIVE suggestions, shown as review cards the user can accept or dismiss. Mention them in one sentence; don't restate their details. They are not active actions until the user accepts them.";
  }

  if (output.alreadySpokenFor > 0) {
    // The nag rule, said out loud. Every timed detail here already produced a reminder and the
    // user resolved it — including, possibly, by turning it down. Re-proposing what someone
    // just rejected is the nag the review gate exists to prevent, so the model must not offer
    // to "set one up" as a workaround for its own empty pass.
    return "Nothing new to propose: every dated or recurring detail on this asset has already proposed a reminder, and the user has already dealt with each one (accepted, dismissed, or still pending). Say plainly that its timed details are already accounted for. Do NOT re-propose them, do NOT offer to add them another way, and do NOT invent a reason such as a missing date.";
  }

  return "Nothing to propose: this asset has no reviewed detail carrying a future date or a recurring interval — an exact fact like a model number is recall, not a reminder. Say so plainly. Do not invent a reminder, and do not imply a detail is missing information it does not need.";
}
