import { proposeAssetMemoryActions } from "@tendnote/db/queries/assets";
import { MAX_ASSET_ACTION_PROPOSALS } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  assetId: z
    .uuid()
    .describe(
      "The Asset whose reviewed details should propose reminders — resolved from an asset search or the profile the user is looking at, never guessed.",
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
  description: `Propose SUGGESTED General Actions from an Asset's reviewed details — warranty expiries, renewal dates, maintenance and replacement intervals. Use when the user asks what reminders an asset should have ('should I set a reminder for the fridge filter?', 'remind me about the warranty'), or right after they add a dated/recurring detail to an asset. Proposes at most ${MAX_ASSET_ACTION_PROPOSALS} per pass, and NEVER creates an active action: each proposal is a review card the user accepts or dismisses. A detail that already proposed an action is not proposed again, so calling this twice is safe and silent. Do NOT use it to add a reminder the user explicitly asked for — that is create_general_action. Returns the proposed actions; refer to them by title, never raw ids.`,
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const result = await proposeAssetMemoryActions({
      actorUserId: ownerUserId,
      assetId: input.assetId,
      assetMemoryIds: input.assetMemoryIds,
      // Provenance: this pass came from the assistant, not a click on the profile.
      source: "assistant",
    });

    return {
      found: true as const,
      proposed: result.proposed.map((proposal) => ({
        action: toGeneralActionRef(proposal.action),
      })),
      asset: { id: result.asset.id, name: result.asset.name },
    };
  },
  // The chat renders each proposal as an interactive review card with Accept/Dismiss,
  // so the model offers them in one sentence and defers the detail. An empty pass is a
  // real, calm answer — everything dated here already has its reminder.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        asset: output.asset.name,
        proposed: output.proposed.map((entry) => toGeneralActionModelRef(entry.action)),
        guidance:
          output.proposed.length === 0
            ? "Nothing new to propose — this asset's dated details already have reminders, or none of them carries a date or interval. Say so plainly; do not invent a reminder."
            : "These are TENTATIVE suggestions, shown as review cards the user can accept or dismiss. Mention them in one sentence; don't restate their details. They are not active actions until the user accepts them.",
      },
    };
  },
});
