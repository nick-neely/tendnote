"use server";

import {
  captureLoggedContext,
  captureSourceRecord,
  getSourceRecordReview,
} from "@tendnote/db/queries/source-records";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { captureSourceRecordForPersonWithEmbeddingDelivery } from "@/lib/background-jobs/embedding-schedulers";
import {
  enqueueAndPublishActionExtractionJob,
  enqueueAndPublishExtractionJob,
} from "@/lib/background-jobs/extraction-queue";
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

  // The shared capture→extract sequence (branch on person, capture, best-effort
  // enqueue) lives in @tendnote/db; this action injects the web's wiring and keeps
  // only its own presentation framing (the reloaded review view below).
  const result = await captureLoggedContext(
    {
      ownerUserId,
      retainedContent: parsed.retainedContent,
      personId: parsed.personId,
      captureSurface,
    },
    {
      captureForPerson: captureSourceRecordForPersonWithEmbeddingDelivery,
      captureGlobal: captureSourceRecord,
      enqueueExtraction: enqueueAndPublishExtractionJob,
      enqueueActionExtraction: enqueueAndPublishActionExtractionJob,
    },
  );

  const review = await getSourceRecordReview({
    ownerUserId,
    sourceRecordId: result.component.sourceRecordId,
  });

  if (!review) {
    throw new Error("Captured source record could not be reloaded.");
  }

  return toSourceRecordReviewView(review);
}
