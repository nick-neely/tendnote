import type { TodayCandidate } from "@tendnote/domain";
import { describeRecurrence, isPersonallyRelevantHouseholdRecord } from "@tendnote/domain";
import type { TodayCandidateLoaderDeps } from "../candidate-loaders";
import type { TodayCandidateLoader } from "../types";
import { classifyDatedAction, formatDateInZone, formatDateOnly, sourceSensitivity } from "./shared";

/**
 * Narrowed to the three deps this loader actually reads, so a caller composing
 * Today's Action family on its own — the Household home / private Today boundary
 * suite is one — does not have to supply the calendar, relationship, and review
 * readers it will never call.
 */
export type TodayActionCandidateDeps = Pick<
  TodayCandidateLoaderDeps,
  "listActions" | "listOwnReminderRecordIds" | "getSourceRecord"
>;

export async function loadActionCandidates(
  deps: TodayActionCandidateDeps,
  input: Parameters<TodayCandidateLoader>[0],
): Promise<TodayCandidate[]> {
  const actions = await deps.listActions({ ownerUserId: input.ownerUserId, limit: 40 });
  const subscribedRecordIds = new Set(
    await (deps.listOwnReminderRecordIds?.({ ownerUserId: input.ownerUserId }) ?? []),
  );
  const candidates = await Promise.all(
    actions.map(async (action): Promise<TodayCandidate | null> => {
      const timing = classifyDatedAction(action, { localDate: input.localDate, now: input.now });
      // A date that has not arrived is not relevant to me *now*, so Today drops
      // the `scheduled` branch the Household home keeps for Coming up.
      if (!timing || timing.code === "scheduled") return null;
      const reason = timing.code;
      // Household visibility alone is not personal relevance. Without this,
      // every chore would land in both partners' shortlists and Today would stop
      // answering what is relevant to *me* (#383, narrowing Phase Seven).
      if (
        !isPersonallyRelevantHouseholdRecord({
          memberUserId: input.ownerUserId,
          ownership: action.ownership,
          ownerUserId: action.ownerUserId,
          scope: action.scope,
          responsibilityHolderUserId: action.responsibilityHolderUserId,
          hasOwnReminderSchedule: subscribedRecordIds.has(action.id),
        })
      ) {
        return null;
      }
      const sensitivity = await sourceSensitivity(deps, input.ownerUserId, action.sourceRecordId);
      if (sensitivity === "restricted") return null;
      const routine = action.recurrence !== null;
      const reasonAt = timing.at;
      return {
        identity: `${routine ? "routine" : "action"}:${action.id}`,
        family: routine ? "routine" : "action",
        record: { kind: "general_action", id: action.id, href: `/actions#action-${action.id}` },
        title: action.title,
        context:
          routine && action.recurrence
            ? `Routine · ${describeRecurrence(action.recurrence)}`
            : "Action",
        reason: {
          code: reason,
          key: `${reason}:${reasonAt.toISOString()}`,
          // `code` stays the machine key; the sentence the owner reads never says
          // "overdue" (DESIGN.md §9: no guilt language on surfaced records).
          explanation:
            reason === "overdue"
              ? `Waiting since ${formatDateOnly(reasonAt)}.`
              : reason === "due_today"
                ? "Due today."
                : `Set to return ${formatDateInZone(reasonAt, input.timeZone)}.`,
        },
        sourceRefs: [
          { kind: "general_action", id: action.id },
          ...(action.sourceRecordId ? [{ kind: "source_record", id: action.sourceRecordId }] : []),
        ],
        action: { kind: "complete_action", label: "Complete" },
        mandatory: reason !== "resurfaced",
        dueAt: reasonAt,
        createdAt: action.createdAt,
        sensitivity,
      };
    }),
  );
  return candidates.filter((candidate): candidate is TodayCandidate => candidate !== null);
}
