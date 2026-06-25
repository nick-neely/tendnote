"use server";

import {
  captureSourceRecord,
  captureSourceRecordForPerson,
  enqueueExtractionJob,
  getSourceRecordReview,
} from "@tendnote/db";
import { z } from "zod";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import {
  type SourceRecordReviewView,
  toSourceRecordReviewView,
} from "@/lib/source-record-review-view";

const captureGlobalAssistantSourceRecordSchema = z.object({
  retainedContent: z.string().trim().min(1).max(4000),
  // When the assistant is launched from a person profile, capture links the note
  // to that already-resolved person so identity is unambiguous (issue #9).
  personId: z.uuid().optional(),
});

export async function captureGlobalAssistantSourceRecord(input: {
  retainedContent: string;
  personId?: string;
}): Promise<SourceRecordReviewView> {
  const parsed = captureGlobalAssistantSourceRecordSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const captureSurface = parsed.personId ? "person_assistant" : "global_assistant";
  const result = parsed.personId
    ? await captureSourceRecordForPerson({
        ownerUserId,
        personId: parsed.personId,
        retainedContent: parsed.retainedContent,
        metadataJson: { captureSurface },
      })
    : await captureSourceRecord({
        ownerUserId,
        retainedContent: parsed.retainedContent,
        metadataJson: { captureSurface },
      });

  // Capture is the synchronous guarantee; suggested-memory extraction is async
  // and job-backed (ADR 0017, ADR 0018). Enqueue the extraction job for the saved
  // record, but never let a queueing failure lose the note the user just captured.
  try {
    await enqueueExtractionJob({ sourceRecordId: result.component.sourceRecordId });
  } catch {
    // The source record is already persisted and can be re-enqueued later; the
    // capture must still succeed for the user.
  }

  const review = await getSourceRecordReview({
    ownerUserId,
    sourceRecordId: result.component.sourceRecordId,
  });

  if (!review) {
    throw new Error("Captured source record could not be reloaded.");
  }

  return toSourceRecordReviewView(review);
}
