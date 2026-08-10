"use server";

import type { RelationshipShareState } from "@tendnote/db/queries/relationship-shares";
import { shareRelationshipRecord } from "@tendnote/db/queries/relationship-shares";
import { relationshipRecordKindSchema } from "@tendnote/domain";
import { visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { z } from "zod";
import type { OwnerActionResult } from "@/lib/owner-action";
import { runOwnerAction } from "@/lib/owner-action";

export type RelationshipShareResult = OwnerActionResult<RelationshipShareState>;

const setAudienceSchema = z
  .object({
    recordKind: relationshipRecordKindSchema,
    recordId: z.uuid(),
    visibilityChoice: visibilityChoiceSchema,
    // A wire cap only. Which of these are real, active members is decided
    // against the roster in the database seam, not here.
    selectedUserIds: z.array(z.string().min(1).max(200)).max(50).optional(),
    confirmedRestricted: z.boolean().optional(),
  })
  .strict();

/**
 * Sets who may read one of the owner's relationship records.
 *
 * One action for all three choices — only me, specific people, whole household —
 * because they are one decision with one outcome, and splitting them would let a
 * surface widen an audience through a path that never considered narrowing it.
 *
 * It deliberately does not use the runner's `visibilityChoice` hook. That hook
 * resolves the caller's household for a record being *created*; here the record
 * already exists, and its household is resolved inside the sharing seam from the
 * owner's own current membership, so the proof and the write agree on one answer
 * read at one moment (ADR 0219).
 */
export async function setRelationshipShareAudienceAction(
  input: unknown,
): Promise<RelationshipShareResult> {
  return runOwnerAction({
    schema: setAudienceSchema,
    input,
    budget: { costCategory: "server-action" },
    body: ({ ownerUserId, input: parsed }) =>
      shareRelationshipRecord({
        ownerUserId,
        recordKind: parsed.recordKind,
        recordId: parsed.recordId,
        visibilityChoice: parsed.visibilityChoice,
        selectedUserIds: parsed.selectedUserIds,
        confirmedRestricted: parsed.confirmedRestricted,
      }),
    // The owner's own ledger and their timely surfaces: a follow-up leaving
    // private scope changes what Today owes them, and the person page shows the
    // record's audience.
    affectedScopes: (_state, ownerUserId) => [
      { kind: "owner-collection", collection: "people", ownerUserId },
      { kind: "owner-collection", collection: "today", ownerUserId },
    ],
    result: (state) => state,
  });
}
