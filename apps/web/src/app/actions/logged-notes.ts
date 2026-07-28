"use server";

import { dismissExtractedMemoriesForSourceRecord } from "@tendnote/db/queries/memories";
import { affectedScopesForPerson } from "@tendnote/db/queries/people";
import { z } from "zod";
import { approveExtractedMemoriesForSourceRecordWithEmbeddingDelivery } from "@/lib/background-jobs/embedding-schedulers";
import { runOwnerAction } from "@/lib/owner-action";

// personId is the note's already-resolved person, used only to re-render their
// profile after the action so the new memories show on their ledger.
const loggedNoteSchema = z.object({ sourceRecordId: z.uuid(), personId: z.uuid().optional() });

/**
 * Approve a logged note inline — rides the automatic extraction pipeline rather than
 * replacing it. Pre-approves the note so the extractor saves whatever it distills as
 * confirmed memories, and approves anything already extracted (the local/inline case).
 */
export async function approveLoggedNoteAction(input: {
  sourceRecordId: string;
  personId?: string;
}) {
  return runOwnerAction({
    schema: loggedNoteSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => ({
      outcome: await approveExtractedMemoriesForSourceRecordWithEmbeddingDelivery({
        ownerUserId,
        sourceRecordId: parsed.sourceRecordId,
      }),
      ownerUserId,
      personId: parsed.personId,
    }),
    affectedScopes: ({ outcome, ownerUserId, personId }) => [
      ...outcome.affectedScopes,
      ...(personId ? affectedScopesForPerson({ ownerUserId, personId }) : []),
    ],
    result: ({ outcome }) => ({
      sourceRecordId: outcome.result.sourceRecordId,
      approvedMemoryCount: outcome.result.approvedMemoryIds.length,
    }),
  });
}

/** Dismiss a logged note inline: stops further extraction and clears its suggestions. */
export async function dismissLoggedNoteAction(input: {
  sourceRecordId: string;
  personId?: string;
}) {
  return runOwnerAction({
    schema: loggedNoteSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => ({
      outcome: await dismissExtractedMemoriesForSourceRecord({
        ownerUserId,
        sourceRecordId: parsed.sourceRecordId,
      }),
      ownerUserId,
      personId: parsed.personId,
    }),
    affectedScopes: ({ outcome, ownerUserId, personId }) => [
      ...outcome.affectedScopes,
      ...(personId ? affectedScopesForPerson({ ownerUserId, personId }) : []),
    ],
    result: ({ outcome }) => ({
      sourceRecordId: outcome.result.sourceRecordId,
      status: outcome.result.status,
    }),
  });
}
