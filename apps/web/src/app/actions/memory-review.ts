"use server";

import {
  archiveMemory,
  dismissSuggestedMemory,
  editSuggestedMemory,
  saveSuggestedMemory,
} from "@tendnote/db";
import { memoryReviewEditSchema } from "@tendnote/domain";
import { z } from "zod";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
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
  const ownerUserId = await getCurrentOwnerUserId();
  const result = await saveSuggestedMemory({ ownerUserId, ...parsed });

  return toSuggestedMemoryReviewView(result);
}

export async function editSuggestedMemoryAction(input: {
  memoryId: string;
  edit: z.input<typeof memoryReviewEditSchema>;
}): Promise<SuggestedMemoryReviewView> {
  const parsed = memoryEditActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const result = await editSuggestedMemory({ ownerUserId, ...parsed });

  return toSuggestedMemoryReviewView(result);
}

export async function dismissSuggestedMemoryAction(input: {
  memoryId: string;
}): Promise<MemoryReviewResolution> {
  const parsed = memoryActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const memory = await dismissSuggestedMemory({ ownerUserId, memoryId: parsed.memoryId });

  return { memoryId: memory.id, status: memory.status };
}

export async function archiveSuggestedMemoryAction(input: {
  memoryId: string;
}): Promise<MemoryReviewResolution> {
  const parsed = memoryActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const memory = await archiveMemory({ ownerUserId, memoryId: parsed.memoryId });

  return { memoryId: memory.id, status: memory.status };
}
