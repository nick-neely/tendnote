import { archiveMemory } from "@tendnote/db/queries/memories";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  memoryId: z
    .uuid()
    .describe(
      "The exact memory to archive, copied from a result in this conversation - the memory you just saved, or one a review tool returned. Never guess an id, and never archive one the user has not pointed at.",
    ),
});

/**
 * "Forget that" - the explicit path, and only the explicit one.
 *
 * Archiving takes a memory out of every normal view while keeping the record and its
 * provenance (ADR 0024): it is the product's forget, not a delete. The reason it is a
 * root tool rather than a curator one is ADR 0123, which makes `memory_curator`
 * review-only precisely so that nothing acting on its own judgement can remove what
 * the user believes Tendnote holds. Curation proposes; this executes a person's
 * instruction, and the two must not be reachable from the same place.
 *
 * Resolution is deterministic or nothing. There is no search, no "the one about the
 * move", and no person-wide sweep - the id has to come from a result in the current
 * conversation, because the failure mode is quietly losing a fact the user still
 * wanted and only finding out months later.
 *
 * The seam is idempotent and this tool stays honest about that: archiving something
 * already archived is not an error and is not reported as a change. What comes back
 * is the memory's state now, never a claim about what this call did.
 */
export default defineTool({
  description:
    "Archive one memory the user explicitly asks you to drop in the current turn ('forget that', 'archive that memory about the move'). Requires a memoryId from a result in this conversation - a memory you just saved or one a review tool returned. Archiving takes it out of recall and every normal view while keeping the record itself; it is not a deletion, and the user can restore it in the app. Do NOT use this on your own initiative, to tidy up memories you judge stale, wrong, or duplicated, to act on a cleanup proposal the user has not accepted, or on more than the one memory they pointed at. If it is not obvious exactly which memory they mean, ask - never archive a guess. Confirm plainly afterwards and do not keep using the fact.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      archiveMemory({ ownerUserId, memoryId: input.memoryId }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      memoryId: outcome.result.id,
      personId: outcome.result.personId,
      // The record's status as it stands now. Deliberately not an `archived: true`
      // flag the tool asserts about itself: the seam returns the same memory whether
      // this call moved it or found it already archived.
      status: outcome.result.status,
    };
  },
  /**
   * The content does not come back. The model has just been told to stop using this
   * fact, and handing it the text on the way out is the one thing most likely to put
   * it in the reply.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        status: output.status,
        guidance:
          "The memory is archived: it is out of recall and out of every normal view, and " +
          "the record is kept rather than deleted. Confirm in one short sentence without " +
          "restating what it said, and do not use that fact again in this conversation. If " +
          "the user wants it back, that happens in the app.",
      },
    };
  },
});
