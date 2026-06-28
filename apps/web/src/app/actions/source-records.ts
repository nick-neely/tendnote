"use server";

import { enqueueAndTriggerExtractionJob } from "@tendnote/db/queries/extraction-jobs";
import {
  captureSourceRecord,
  captureSourceRecordForPerson,
  getSourceRecordReview,
} from "@tendnote/db/queries/source-records";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
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
  const ownerUserId = await requireAdmittedOwnerForAction();
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

  // Capture is the synchronous guarantee; suggested-memory extraction is job-backed
  // (ADR 0017, ADR 0018). Triggering may process inline in local/dev, but it must
  // never make the saved note disappear if extraction is unavailable.
  try {
    await enqueueAndTriggerExtractionJob({ sourceRecordId: result.component.sourceRecordId });
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
