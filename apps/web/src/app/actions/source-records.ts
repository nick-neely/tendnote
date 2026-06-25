"use server";

import { captureSourceRecord, getSourceRecordReview } from "@tendnote/db";
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
  const review = await getSourceRecordReview({
    ownerUserId,
    sourceRecordId: result.component.sourceRecordId,
  });

  if (!review) {
    throw new Error("Captured source record could not be reloaded.");
  }

  return toSourceRecordReviewView(review);
}
