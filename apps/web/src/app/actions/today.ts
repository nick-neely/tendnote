"use server";

import { completeFollowup } from "@tendnote/db/queries/followups";
import { completeGeneralAction } from "@tendnote/db/queries/general-actions";
import {
  getOwnerTodayContext,
  getTodayCandidate,
  getTodayShortlist,
  suppressTodayCandidate,
} from "@tendnote/db/queries/today";
import { type TodayShortlistResponse, todayShortlistResponseSchema } from "@tendnote/domain/today";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { invalidateTodayOwner } from "@/lib/cache/today-review-mutation-scopes";

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const candidateRefSchema = z.object({
  localDate: localDateSchema,
  candidateIdentity: z.string().min(1).max(500),
  reasonKey: z.string().min(1).max(500),
});
const suppressionSchema = z.discriminatedUnion("kind", [
  candidateRefSchema.extend({ kind: z.literal("not_today"), suppressUntil: z.null() }),
  candidateRefSchema.extend({ kind: z.literal("later"), suppressUntil: z.coerce.date() }),
]);

export async function refreshTodayAction(input: {
  localDate: string;
}): Promise<TodayShortlistResponse> {
  const localDate = localDateSchema.parse(input.localDate);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const context = await getOwnerTodayContext({ ownerUserId });
  if (localDate !== context.localDate) throw new Error("Today has rolled to a new local day.");
  return todayShortlistResponseSchema.parse(
    await getTodayShortlist({ ownerUserId, ...context, forceRefresh: true }),
  );
}

export async function suppressTodayItemAction(input: {
  localDate: string;
  candidateIdentity: string;
  reasonKey: string;
  kind: "later" | "not_today";
  suppressUntil: Date | null;
}): Promise<TodayShortlistResponse> {
  const parsed = suppressionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const context = await getOwnerTodayContext({ ownerUserId });
  if (parsed.localDate !== context.localDate)
    throw new Error("Today has rolled to a new local day.");
  await suppressTodayCandidate({ ownerUserId, ...parsed, ...context });
  invalidateTodayOwner(ownerUserId);
  return todayShortlistResponseSchema.parse(await getTodayShortlist({ ownerUserId, ...context }));
}

export async function actOnTodayItemAction(input: {
  localDate: string;
  candidateIdentity: string;
  reasonKey: string;
}): Promise<TodayShortlistResponse> {
  const parsed = candidateRefSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const context = await getOwnerTodayContext({ ownerUserId });
  if (parsed.localDate !== context.localDate)
    throw new Error("Today has rolled to a new local day.");
  const candidate = await getTodayCandidate({ ownerUserId, ...context, ...parsed });
  if (!candidate) throw new Error("Today item is no longer available.");

  if (candidate.action.kind === "complete_follow_up" && candidate.record.kind === "follow_up") {
    await completeFollowup({ actorUserId: ownerUserId, followupId: candidate.record.id });
  } else if (
    candidate.action.kind === "complete_action" &&
    candidate.record.kind === "general_action"
  ) {
    await completeGeneralAction({ actorUserId: ownerUserId, generalActionId: candidate.record.id });
  } else {
    throw new Error("Open this Today item to use its domain action.");
  }

  invalidateTodayOwner(ownerUserId);
  return todayShortlistResponseSchema.parse(await getTodayShortlist({ ownerUserId, ...context }));
}
