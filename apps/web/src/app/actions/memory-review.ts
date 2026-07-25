"use server";

import {
  archiveMemory,
  dismissSuggestedMemory,
  editSuggestedMemory,
} from "@tendnote/db/queries/memories";
import { memoryReviewEditSchema } from "@tendnote/domain";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { saveSuggestedMemoryWithEmbeddingDelivery } from "@/lib/background-jobs/embedding-schedulers";
import { invalidateReviewOwner } from "@/lib/cache/today-review-mutation-scopes";
import {
  type SuggestedMemoryReviewView,
  toSuggestedMemoryReviewView,
} from "@/lib/suggested-memory-review-view";

const memoryActionSchema = z.object({ memoryId: z.uuid() });
const memoryEditActionSchema = z.object({
  memoryId: z.uuid(),
  edit: memoryReviewEditSchema,
});

export type MemoryReviewResolution = {
  memoryId: string;
  status: string;
};

export async function saveSuggestedMemoryAction(input: {
  memoryId: string;
  edit?: z.input<typeof memoryReviewEditSchema>;
}): Promise<SuggestedMemoryReviewView> {
  const parsed = memoryEditActionSchema.parse({ memoryId: input.memoryId, edit: input.edit ?? {} });
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await saveSuggestedMemoryWithEmbeddingDelivery({ ownerUserId, ...parsed });
  invalidateReviewOwner(ownerUserId);
  return toSuggestedMemoryReviewView(result);
}

export async function editSuggestedMemoryAction(input: {
  memoryId: string;
  edit: z.input<typeof memoryReviewEditSchema>;
}): Promise<SuggestedMemoryReviewView> {
  const parsed = memoryEditActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await editSuggestedMemory({ ownerUserId, ...parsed });
  invalidateReviewOwner(ownerUserId);
  return toSuggestedMemoryReviewView(result);
}

export async function dismissSuggestedMemoryAction(input: {
  memoryId: string;
}): Promise<MemoryReviewResolution> {
  const parsed = memoryActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const memory = await dismissSuggestedMemory({ ownerUserId, memoryId: parsed.memoryId });
  invalidateReviewOwner(ownerUserId);
  return { memoryId: memory.id, status: memory.status };
}

export async function archiveSuggestedMemoryAction(input: {
  memoryId: string;
}): Promise<MemoryReviewResolution> {
  const parsed = memoryActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const memory = await archiveMemory({ ownerUserId, memoryId: parsed.memoryId });
  invalidateReviewOwner(ownerUserId);
  return { memoryId: memory.id, status: memory.status };
}
