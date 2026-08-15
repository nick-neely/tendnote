import { parseExplicitMemoryRequest, sensitivitySchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { captureExplicitMemoryWithEmbeddingDelivery } from "../lib/background-jobs/embedding-schedulers";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe("The resolved Tendnote person this memory is about. Resolve identity first."),
  request: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "The user's explicit memory request, e.g. 'Remember Caleb is moving to Denver in August'.",
    ),
  sensitivity: sensitivitySchema
    .optional()
    .describe("Override sensitivity when the user signals the context is delicate."),
});

/**
 * Why there is no `approval:` gate on the one tool that writes a pre-approved
 * durable memory.
 *
 * Eve supports `approval: once()`, and on its face this is the tool that wants
 * one: it writes an *approved* memory, not a suggestion, so nothing downstream
 * asks the user to confirm what was stored. The gate is nonetheless deliberately
 * absent, because the surface that would have to render it does not.
 *
 * Eve's approval protocol parks the turn durably at `session.waiting` and waits
 * for the client to answer with `inputResponses`. The web chat is the only place
 * this tool runs, and it is built on `useEveAgent()`
 * (`apps/web/src/components/assistant-panel.tsx`), which today: never reads an
 * `input.requested` event; never calls the SDK's own `respond(...)`; and filters
 * pending-approval tool parts out of the transcript entirely
 * (`apps/web/src/lib/eve/message-views.ts` - `isActiveToolPart` /
 * `isCompletedToolPart` admit neither). A gate added here would therefore park
 * the turn on a prompt nobody can see and nothing can answer: the user asks Eve
 * to remember something, the reply never arrives, and the memory is never
 * written. That is strictly worse than the ungated write it was meant to guard.
 *
 * What the write actually rests on instead: an explicit in-turn instruction
 * ("remember…", "save…"), the user's own words parsed rather than inferred, a
 * rendered `memory_saved` card, and an ordinary edit/remove path afterwards.
 *
 * Turning this into a real gate is UI work, not tool work, and needs all three:
 * a client-visible parked-turn state, an approve/deny card in the transcript,
 * and `agent.respond(inputResponses)` wired to it.
 */
export default defineTool({
  description:
    "Save an explicit memory for a person when the user says remember, save, note, or keep track of something outside Global Capture. Do not use this for 'Use Capture', 'capture this', or a turn with another supported explicit clause even if the word Capture is absent; capture_saved_item owns that path. Otherwise this creates a durable approved memory backed by a source record. Resolve the person first.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const { content } = parseExplicitMemoryRequest(input.request);

    const { memory, sourceRecord, person } = await withModelSafeStoreErrors(() =>
      captureExplicitMemoryWithEmbeddingDelivery({
        ownerUserId,
        personId: input.personId,
        content,
        sensitivity: input.sensitivity,
      }),
    );

    return {
      memory: {
        id: memory.id,
        personId: memory.personId,
        content: memory.content,
        status: memory.status,
        sensitivity: memory.sensitivity,
        confidence: memory.confidence,
        sourceRecordId: memory.sourceRecordId,
      },
      sourceRecord: {
        id: sourceRecord.id,
        status: sourceRecord.status,
      },
      person: {
        id: person.id,
        displayName: person.displayName,
      },
      // Persisted record reference the web UI renders (ADR 0028): an approved
      // memory grounded in its source record. Distinct from a logged-context
      // source record so the surface never restates a saved fact as tentative.
      component: {
        type: "memory_saved",
        memoryId: memory.id,
        sourceRecordId: memory.sourceRecordId,
        personId: memory.personId,
      },
    };
  },
  // The saved memory is rendered as a card the user already sees. Project the
  // model's view down (Eve `toModelOutput`) to the handles it needs to act, plus a
  // reminder not to reprint the text; the channel still gets the full output above
  // for rendering. See create_message_draft / search_relationship_context.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        saved: true,
        memoryId: output.memory.id,
        personId: output.memory.personId,
        person: output.person.displayName,
        sensitivity: output.memory.sensitivity,
        rendered: "The saved memory is shown to the user in a card.",
        guidance:
          "Don't reprint the memory text — it's in the card. Confirm briefly; you can name the person and offer to change or remove it.",
      },
    };
  },
});
