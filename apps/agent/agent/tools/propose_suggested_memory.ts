import { captureSuggestedMemoryFromSource } from "@tendnote/db/queries/memories";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe(
      "The resolved person this would be a fact about. Resolve identity with search_people first; if you are not certain who they mean, ask instead of calling this.",
    ),
  content: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      "One fact, in the user's own meaningful wording - not your paraphrase, not a summary of the conversation, and not an inference stacked on top of what they said.",
    ),
  sourceRecordId: z
    .uuid()
    .describe(
      "The source record this is drawn from: the note you just logged with capture_source_record, the record under review, or one a person read returned. A memory must be grounded - if there is nothing to ground it in, log the note first.",
    ),
});

/**
 * The producer half of the suggested-memory review queue.
 *
 * Extraction has always been able to put a noticed fact into review; Eve, in
 * conversation, could not. It had `capture_memory` (a durable approved fact, for an
 * explicit "remember this") and nothing in between - so a fact worth keeping that
 * the user had not asked it to keep either became an approved memory it was not
 * entitled to write, or evaporated. This is the in-between, and it is the same seam
 * extraction writes through: `suggested` status, review card, the user's accept is
 * what makes it true (ADRs 0002, 0056).
 *
 * Grounding is required rather than manufactured. `propose_asset_memories` captures
 * the user's sentence as a Source Record itself, which leaves an orphaned note behind
 * whenever the second write fails; this tool takes an id that already exists, so the
 * proposal is one write and a failure leaves nothing. ADR 0022's rule - a Source
 * Record behind every memory - is satisfied by the note the model was told to log
 * first, which is the same note the review card shows the fact against.
 *
 * Importance, sensitivity, and scope are the seam's: importance is the queue's
 * default, sensitivity is inherited from the source record so a delicate note cannot
 * be laundered into an ordinary fact by the wording of a proposal, and the scope is
 * private. None of the three is a model-facing field.
 */
export default defineTool({
  description:
    "Propose a SUGGESTED memory about a person for the user to review - never a saved fact. Use this when something worth keeping came up in the conversation and the user did NOT ask you to remember it ('she mentioned her sister is moving to Denver in August' after you logged the note). If they DID say remember/save/note/keep track of, that is `capture_memory` and it is approved directly; on a 'Use Capture' turn, `capture_saved_item` owns the path instead. Resolve one person with `search_people` first and ensure a grounding Source Record exists (use `capture_source_record` when the note is new), then call this tool in the same turn before replying whenever you promise or offer a Suggested Memory. A promise in prose is not the review artifact: do not ask whether they want a suggestion or say you will put one up without making this call. Requires a resolved personId, one fact in their own words, and the sourceRecordId it comes from. Do NOT scan a person's history or a search result and propose facts in bulk, do NOT propose more than the one thing that actually came up, do NOT propose from restricted or delicate context the user has not raised in this turn, and do NOT re-propose something they already dismissed. NOTHING IS SAVED: it becomes a review card the user accepts or dismisses. Say it is waiting for their review; never say you saved, logged, noted, or now remember it, and never repeat it back later as a stored fact.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      captureSuggestedMemoryFromSource({
        ownerUserId,
        personId: input.personId,
        sourceRecordId: input.sourceRecordId,
        content: input.content,
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const { memory, person, sourceRecord } = outcome.result;

    return {
      // Matches the shared suggested-memory review contract, so this renders as the
      // same review card `get_suggested_memory_review` produces - with the accept and
      // dismiss controls that are the entire point of proposing rather than saving.
      found: true as const,
      person: { id: person.id, displayName: person.displayName },
      memory: {
        id: memory.id,
        personId: memory.personId,
        content: memory.content,
        status: memory.status,
        sensitivity: memory.sensitivity,
        sourceRecordId: memory.sourceRecordId,
      },
      sourceRecord: { id: sourceRecord.id },
      component: {
        type: "suggested_memory_review",
        memoryId: memory.id,
        sourceRecordId: memory.sourceRecordId,
      },
    };
  },
  /**
   * The card carries the text, so the model gets the handles and the warning it
   * needs and not the fact it just proposed - reprinting it is how a tentative
   * suggestion starts sounding like something Eve knows.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        proposed: true,
        saved: false,
        memoryId: output.memory.id,
        person: output.person.displayName,
        status: output.memory.status,
        rendered:
          "The suggestion is shown to the user as a review card they can approve or dismiss.",
        guidance:
          "NOTHING WAS SAVED. Say you have put it up for review, in one short line, without " +
          "reprinting the fact - the card shows it. Never say you saved, logged, noted, or " +
          "now remember it, do not state it as fact in a later turn, and approve it only if " +
          "the user explicitly says to.",
      },
    };
  },
});
