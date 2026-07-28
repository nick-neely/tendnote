"use server";

import { completeFollowup } from "@tendnote/db/queries/followups";
import {
  affectedScopesForOwnerSurfaces,
  completeGeneralAction,
} from "@tendnote/db/queries/general-actions";
import {
  getOwnerTodayContext,
  getTodayCandidate,
  getTodayShortlist,
  suppressTodayCandidate,
} from "@tendnote/db/queries/today";
import { todayShortlistResponseSchema } from "@tendnote/domain/today";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

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

export async function refreshTodayAction(input: { localDate: string }) {
  return runOwnerAction({
    schema: z.object({ localDate: localDateSchema }),
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const context = await getOwnerTodayContext({ ownerUserId });
      if (parsed.localDate !== context.localDate)
        throw new Error("Today has rolled to a new local day.");
      return getTodayShortlist({ ownerUserId, ...context, forceRefresh: true });
    },
    result: (shortlist) => todayShortlistResponseSchema.parse(shortlist),
  });
}

export async function suppressTodayItemAction(input: {
  localDate: string;
  candidateIdentity: string;
  reasonKey: string;
  kind: "later" | "not_today";
  suppressUntil: Date | null;
}) {
  return runOwnerAction({
    schema: suppressionSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const context = await getOwnerTodayContext({ ownerUserId });
      if (parsed.localDate !== context.localDate)
        throw new Error("Today has rolled to a new local day.");
      const outcome = await suppressTodayCandidate({ ownerUserId, ...parsed, ...context });
      return { context, outcome };
    },
    affectedScopes: ({ outcome }) => outcome.affectedScopes,
    result: async ({ context }, ownerUserId) =>
      todayShortlistResponseSchema.parse(await getTodayShortlist({ ownerUserId, ...context })),
  });
}

export async function actOnTodayItemAction(input: {
  localDate: string;
  candidateIdentity: string;
  reasonKey: string;
}) {
  return runOwnerAction({
    schema: candidateRefSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const context = await getOwnerTodayContext({ ownerUserId });
      if (parsed.localDate !== context.localDate)
        throw new Error("Today has rolled to a new local day.");
      const candidate = await getTodayCandidate({ ownerUserId, ...context, ...parsed });
      if (!candidate) throw new Error("Today item is no longer available.");

      const outcome =
        candidate.action.kind === "complete_follow_up" && candidate.record.kind === "follow_up"
          ? await completeFollowup({
              actorUserId: ownerUserId,
              followupId: candidate.record.id,
            })
          : candidate.action.kind === "complete_action" &&
              candidate.record.kind === "general_action"
            ? await completeGeneralAction({
                actorUserId: ownerUserId,
                generalActionId: candidate.record.id,
              })
            : null;
      if (!outcome) throw new Error("Open this Today item to use its domain action.");
      return { context, outcome, ownerUserId };
    },
    affectedScopes: ({ outcome, ownerUserId }) => [
      ...outcome.affectedScopes,
      ...affectedScopesForOwnerSurfaces(ownerUserId),
    ],
    result: async ({ context }, ownerUserId) =>
      todayShortlistResponseSchema.parse(await getTodayShortlist({ ownerUserId, ...context })),
  });
}
