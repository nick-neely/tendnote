import { enqueueExtractionJob } from "@tendnote/db/queries/extraction-jobs";
import {
  captureSourceRecord,
  captureSourceRecordForPerson,
} from "@tendnote/db/queries/source-records";
import { sensitivitySchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
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

    // Context-aware path: when the person is known, capture and link in one
    // shared owner-scoped call; otherwise log a global source record.
    const { sourceRecord, component } = input.personId
      ? await captureSourceRecordForPerson({
          ownerUserId,
          personId: input.personId,
          retainedContent: input.retainedContent,
          sensitivity: input.sensitivity,
          metadataJson: { captureSurface: "eve" },
        })
      : await captureSourceRecord({
          ownerUserId,
          retainedContent: input.retainedContent,
          sensitivity: input.sensitivity,
          metadataJson: { captureSurface: "eve" },
        });

    // Extraction is async and must not fail the synchronous capture (ADR 0017).
    try {
      await enqueueExtractionJob({ sourceRecordId: sourceRecord.id });
    } catch {
      // The source record is already saved and can be re-enqueued later.
    }

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
});
