"use server";

import {
  affectedScopesForOwnerSurfaces,
  completeGeneralAction,
} from "@tendnote/db/queries/general-actions";
import { getHouseholdHome } from "@tendnote/db/queries/household-home";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import { describeProgressReconciliation } from "@tendnote/domain/household-actions";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

const completeRecordSchema = z.object({
  generalActionId: z.uuid(),
  /** The occurrence the member's row was rendered against; fences the advance. */
  expectedOccurrenceVersion: z.number().int().min(0),
});

/**
 * Completing a shared record from the home.
 *
 * It calls the same product function as the Actions surface, so authority,
 * history, occurrence fencing, and reminder invalidation are the domain's and
 * are not re-implemented here. Only completion is offered inline: it is
 * reversible and already authorized for anyone who can see the record, whereas
 * skipping, deferring, pausing, archiving, and holder changes are decisions that
 * belong on the record itself.
 *
 * A member whose tap arrives second is reconciled, never refused. The record
 * advanced once, this says who settled it and when, and the view returned is the
 * household's real state either way.
 */
export async function completeHouseholdHomeRecordAction(input: {
  generalActionId: string;
  expectedOccurrenceVersion: number;
}) {
  return runOwnerAction({
    schema: completeRecordSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const outcome = await completeGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        expectedOccurrenceVersion: parsed.expectedOccurrenceVersion,
      });
      return { outcome, ownerUserId };
    },
    affectedScopes: ({ outcome, ownerUserId }) => [
      ...outcome.affectedScopes,
      ...affectedScopesForOwnerSurfaces(ownerUserId),
    ],
    result: async ({ outcome }, ownerUserId) => ({
      ...(await readHome(ownerUserId)),
      reconciliation: await describeReconciliation(ownerUserId, outcome.result.reconciliation),
    }),
  });
}

/**
 * The member's own local day decides which side of "today" a date falls on.
 *
 * The composition itself is identical for everyone who can see the records; only
 * the day boundary is the reader's, because the reader's day is the only one
 * either member actually experiences.
 */
async function readHome(callerUserId: string) {
  const { localDate, timeZone, now } = await getOwnerTodayContext({ ownerUserId: callerUserId });
  return getHouseholdHome({ callerUserId, localDate, timeZone, now });
}

/**
 * The sentence a member reads when someone else got there first.
 *
 * The name is looked up only when there is one to look up, and the wording is
 * the domain's so every surface reports the same race identically.
 */
async function describeReconciliation(
  callerUserId: string,
  reconciliation: {
    handledAs: "completed" | "skipped";
    handledByUserId: string | null;
    handledAt: Date;
  } | null,
): Promise<string | null> {
  if (!reconciliation) return null;
  const members = reconciliation.handledByUserId
    ? await listShareableHouseholdMembersForUser({ userId: callerUserId })
    : [];
  return describeProgressReconciliation(
    {
      handledAs: reconciliation.handledAs,
      handledByName:
        members.find((member) => member.userId === reconciliation.handledByUserId)?.name ?? null,
      handledAt: reconciliation.handledAt,
    },
    (date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date),
  );
}
