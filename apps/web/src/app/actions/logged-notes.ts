"use server";

import {
  approveExtractedMemoriesForSourceRecord,
  dismissExtractedMemoriesForSourceRecord,
} from "@tendnote/db/queries/memories";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

// personId is the note's already-resolved person, used only to re-render their
// profile after the action so the new memories show on their ledger.
const loggedNoteSchema = z.object({ sourceRecordId: z.uuid(), personId: z.uuid().optional() });

export type LoggedNoteApproval = { sourceRecordId: string; approvedMemoryCount: number };
export type LoggedNoteDismissal = { sourceRecordId: string; status: string };

/**
 * Approve a logged note inline — rides the automatic extraction pipeline rather than
 * replacing it. Pre-approves the note so the extractor saves whatever it distills as
 * confirmed memories, and approves anything already extracted (the local/inline case).
 */
export async function approveLoggedNoteAction(input: {
  sourceRecordId: string;
  personId?: string;
}): Promise<LoggedNoteApproval> {
  const parsed = loggedNoteSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await approveExtractedMemoriesForSourceRecord({
    ownerUserId,
    sourceRecordId: parsed.sourceRecordId,
  });

  if (parsed.personId) {
    revalidatePath(`/people/${parsed.personId}`);
  }
  return {
    sourceRecordId: result.sourceRecordId,
    approvedMemoryCount: result.approvedMemoryIds.length,
  };
}

/** Dismiss a logged note inline: stops further extraction and clears its suggestions. */
export async function dismissLoggedNoteAction(input: {
  sourceRecordId: string;
  personId?: string;
}): Promise<LoggedNoteDismissal> {
  const parsed = loggedNoteSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await dismissExtractedMemoriesForSourceRecord({
    ownerUserId,
    sourceRecordId: parsed.sourceRecordId,
  });

  if (parsed.personId) {
    revalidatePath(`/people/${parsed.personId}`);
  }
  return { sourceRecordId: result.sourceRecordId, status: result.status };
}
