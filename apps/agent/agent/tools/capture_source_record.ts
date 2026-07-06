import { captureLoggedContext, captureSourceRecord } from "@tendnote/db/queries/source-records";
import { sensitivitySchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { captureSourceRecordForPersonWithEmbeddingDelivery } from "../lib/background-jobs/embedding-schedulers";
import {
  enqueueAndPublishActionExtractionJob,
  enqueueAndPublishExtractionJob,
} from "../lib/background-jobs/extraction-queue";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  retainedContent: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "The relationship context to log. Use this for casual notes that are NOT an explicit remember/save request — the result is logged context, not a confirmed fact.",
    ),
  personId: z
    .uuid()
    .optional()
    .describe(
      "Link the note to a known, already-resolved person. Provide ONLY when identity is unambiguous; otherwise omit and ask the user to disambiguate.",
    ),
  sensitivity: sensitivitySchema
    .optional()
    .describe("Override when the user signals the context is delicate."),
});

/**
 * Thin wrapper over the shared owner-scoped capture path: saves a source record
 * synchronously (ADR 0015, ADR 0032), links it to a known person when identity
 * is certain, and enqueues async suggested-memory extraction (ADR 0017). Casual
 * notes become logged context, never confirmed facts — the user reviews any
 * suggestions later.
 */
export default defineTool({
  description:
    "Log a casual relationship note as a source record (logged context, not a confirmed fact). Use this when the user shares context without an explicit remember/save instruction. Returns persisted ids for review components. For explicit 'remember/save/note/keep track of' requests use capture_memory instead. If the person is ambiguous, ask to disambiguate rather than guessing a personId.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    // The shared capture→extract sequence (branch on person, capture, best-effort
    // enqueue) lives in @tendnote/db; this tool injects Eve's wiring and keeps only
    // its own presentation framing.
    const { sourceRecord, component } = await captureLoggedContext(
      {
        ownerUserId,
        retainedContent: input.retainedContent,
        personId: input.personId,
        sensitivity: input.sensitivity,
        captureSurface: "eve",
      },
      {
        captureForPerson: captureSourceRecordForPersonWithEmbeddingDelivery,
        captureGlobal: captureSourceRecord,
        enqueueExtraction: enqueueAndPublishExtractionJob,
        enqueueActionExtraction: enqueueAndPublishActionExtractionJob,
      },
    );

    return {
      sourceRecord: {
        id: sourceRecord.id,
        status: sourceRecord.status,
        content: sourceRecord.content,
      },
      linkedPersonId: input.personId ?? null,
      component,
    };
  },
  // The logged note is rendered as a card the user already sees. Drop the note text
  // from the model's view (Eve `toModelOutput`) so it frames briefly instead of
  // reprinting it; the channel still gets the full output above for rendering.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        saved: true,
        sourceRecordId: output.sourceRecord.id,
        linkedPersonId: output.linkedPersonId,
        rendered: "The logged note is shown to the user in a card.",
        guidance:
          "Don't reprint the note — it's in the card. Confirm briefly that you logged it (it's logged context, not a confirmed fact) and offer to change it.",
      },
    };
  },
});
