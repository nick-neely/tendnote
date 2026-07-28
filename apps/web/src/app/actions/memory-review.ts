"use server";

import {
  archiveMemory,
  dismissSuggestedMemory,
  editSuggestedMemory,
  getSuggestedMemoryReview,
  restoreDismissedSuggestedMemory,
} from "@tendnote/db/queries/memories";
import { memoryReviewEditSchema } from "@tendnote/domain";
import { z } from "zod";
import { saveSuggestedMemoryWithEmbeddingDelivery } from "@/lib/background-jobs/embedding-schedulers";
import { runOwnerAction } from "@/lib/owner-action";
import { toSuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

const memoryActionSchema = z.object({ memoryId: z.uuid() });
const memoryEditActionSchema = z.object({
  memoryId: z.uuid(),
  edit: memoryReviewEditSchema,
});

export async function saveSuggestedMemoryAction(input: {
  memoryId: string;
  edit?: z.input<typeof memoryReviewEditSchema>;
}) {
  return runOwnerAction({
    schema: memoryEditActionSchema,
    input: { memoryId: input.memoryId, edit: input.edit ?? {} },
    body: ({ ownerUserId, input: parsed }) =>
      saveSuggestedMemoryWithEmbeddingDelivery({ ownerUserId, ...parsed }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toSuggestedMemoryReviewView(outcome.result),
  });
}

export async function editSuggestedMemoryAction(input: {
  memoryId: string;
  edit: z.input<typeof memoryReviewEditSchema>;
}) {
  return runOwnerAction({
    schema: memoryEditActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) => editSuggestedMemory({ ownerUserId, ...parsed }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toSuggestedMemoryReviewView(outcome.result),
  });
}

export async function dismissSuggestedMemoryAction(input: { memoryId: string }) {
  return runOwnerAction({
    schema: memoryActionSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const review = await getSuggestedMemoryReview({
        ownerUserId,
        memoryId: parsed.memoryId,
      });
      if (!review) throw new Error("Suggested memory not found.");
      const outcome = await dismissSuggestedMemory({ ownerUserId, memoryId: parsed.memoryId });
      return { ...outcome, result: review };
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toSuggestedMemoryReviewView(outcome.result),
  });
}

export async function restoreDismissedSuggestedMemoryAction(input: { memoryId: string }) {
  return runOwnerAction({
    schema: memoryActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      restoreDismissedSuggestedMemory({ ownerUserId, memoryId: parsed.memoryId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toSuggestedMemoryReviewView(outcome.result),
  });
}

export async function archiveSuggestedMemoryAction(input: { memoryId: string }) {
  return runOwnerAction({
    schema: memoryActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      archiveMemory({ ownerUserId, memoryId: parsed.memoryId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ memoryId: outcome.result.id, status: outcome.result.status }),
  });
}
