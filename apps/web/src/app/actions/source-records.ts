"use server";

import {
  type AffectedScope,
  affectedScopesForOwnerSurfaces,
} from "@tendnote/db/queries/general-actions";
import { affectedScopesForPerson } from "@tendnote/db/queries/people";
import {
  captureLoggedContext,
  captureSourceRecord,
  getSourceRecordReview,
} from "@tendnote/db/queries/source-records";
import { z } from "zod";
import { captureSourceRecordForPersonWithEmbeddingDelivery } from "@/lib/background-jobs/embedding-schedulers";
import {
  enqueueAndPublishActionExtractionJob,
  enqueueAndPublishExtractionJob,
} from "@/lib/background-jobs/extraction-queue";
import { runOwnerAction } from "@/lib/owner-action";
import { toSourceRecordReviewView } from "@/lib/source-record-review-view";

const captureGlobalAssistantSourceRecordSchema = z.object({
  retainedContent: z.string().trim().min(1).max(4000),
  // When the assistant is launched from a person profile, capture links the note
  // to that already-resolved person so identity is unambiguous (issue #9).
  personId: z.uuid().optional(),
});

export async function captureGlobalAssistantSourceRecord(input: {
  retainedContent: string;
  personId?: string;
}) {
  return runOwnerAction({
    schema: captureGlobalAssistantSourceRecordSchema,
    input,
    budget: { costCategory: "llm-extraction" },
    body: async ({ ownerUserId, input: parsed }) => {
      const captureSurface = parsed.personId ? "person_assistant" : "global_assistant";
      const result = await captureLoggedContext(
        {
          ownerUserId,
          retainedContent: parsed.retainedContent,
          personId: parsed.personId,
          captureSurface,
        },
        {
          captureForPerson: (captureInput) =>
            captureSourceRecordForPersonWithEmbeddingDelivery(captureInput).then(
              (outcome) => outcome.result,
            ),
          captureGlobal: captureSourceRecord,
          enqueueExtraction: enqueueAndPublishExtractionJob,
          enqueueActionExtraction: enqueueAndPublishActionExtractionJob,
        },
      );
      const review = await getSourceRecordReview({
        ownerUserId,
        sourceRecordId: result.component.sourceRecordId,
      });
      if (!review) throw new Error("Captured source record could not be reloaded.");
      return { ownerUserId, personId: parsed.personId, review };
    },
    affectedScopes: ({ ownerUserId, personId }) =>
      [
        ...affectedScopesForOwnerSurfaces(ownerUserId),
        ...(personId ? affectedScopesForPerson({ ownerUserId, personId }) : []),
      ] satisfies AffectedScope[],
    result: ({ review }) => toSourceRecordReviewView(review),
  });
}
