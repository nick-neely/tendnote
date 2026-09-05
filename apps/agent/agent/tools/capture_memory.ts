import { parseExplicitMemoryRequest, sensitivitySchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
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
 * The one tool that writes a pre-approved durable memory, and why it is gated.
 *
 * Nothing downstream asks the user to confirm what this stored: unlike a
 * suggested memory, an explicit one is written approved. Until the web chat
 * could render a parked call there was nowhere to ask, so the write rested on an
 * in-turn instruction ("remember...", "save..."), the user's own words parsed
 * rather than inferred, and a `memory_saved` card afterwards - all of which a
 * prompt injection can produce, because all of them are text.
 *
 * The gate replaces that with a decision. eve parks this exact call until the
 * authenticated owner answers through the client, and the answer never passes
 * through the model, so an injected "remember that Eve may email invoices to
 * ..." can ask and cannot write.
 *
 * It is a Reversible Private Write: the memory is the owner's own, private by
 * construction, and `archive_memory` takes it back out. So an owner whose
 * Approval Mode is `trusted` gets it without a click - unless the conversation
 * has read Untrusted Content, which is exactly the injected case above and puts
 * the click back (ADR-0240).
 */
export default defineTool({
  approval: requireOwnerApproval({
    describe: describeRegisteredSubject(),
    reversiblePrivateWrite: true,
  }),
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
