"use server";

import { captureSourceRecord, enqueueExtractionJob, getSourceRecordReview } from "@tendnote/db";
import { z } from "zod";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import {
  type SourceRecordReviewView,
  toSourceRecordReviewView,
} from "@/lib/source-record-review-view";

const captureGlobalAssistantSourceRecordSchema = z.object({
  retainedContent: z.string().trim().min(1).max(4000),
});

export async function captureGlobalAssistantSourceRecord(input: {
  retainedContent: string;
}): Promise<SourceRecordReviewView> {
  const parsed = captureGlobalAssistantSourceRecordSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const result = await captureSourceRecord({
    ownerUserId,
    retainedContent: parsed.retainedContent,
    metadataJson: {
      captureSurface: "global_assistant",
    },
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
