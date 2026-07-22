import type { ActionSurfacingReason, GeneralAction, TodayCandidate } from "@tendnote/domain";
import { describeRecurrence } from "@tendnote/domain";
import type { TodayCandidateLoaderDeps } from "../candidate-loaders";
import type { TodayCandidateLoader } from "../types";
import { dateOnlyKey, formatDateInZone, formatDateOnly, sourceSensitivity } from "./shared";

export async function loadActionCandidates(
  deps: TodayCandidateLoaderDeps,
  input: Parameters<TodayCandidateLoader>[0],
): Promise<TodayCandidate[]> {
  const actions = await deps.listActions({ ownerUserId: input.ownerUserId, limit: 40 });
  const candidates = await Promise.all(
    actions.map(async (action): Promise<TodayCandidate | null> => {
      const reason = classifyTodayAction(action, { localDate: input.localDate, now: input.now });
      if (!reason) return null;
      const sensitivity = await sourceSensitivity(deps, input.ownerUserId, action.sourceRecordId);
      if (sensitivity === "restricted") return null;
      const routine = action.recurrence !== null;
      const reasonAt = reason === "resurfaced" ? action.deferUntil : action.dueAt;
      if (!reasonAt) return null;
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
          explanation:
            reason === "overdue"
              ? `Overdue since ${formatDateOnly(reasonAt)}.`
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

function classifyTodayAction(
  action: Pick<GeneralAction, "status" | "dueAt" | "deferUntil">,
  day: { localDate: string; now: Date },
): ActionSurfacingReason | null {
  if (action.status === "deferred") {
    return action.deferUntil && action.deferUntil.getTime() <= day.now.getTime()
      ? "resurfaced"
      : null;
  }
  if (action.status !== "open" || !action.dueAt) {
    return null;
  }
  const dueDate = dateOnlyKey(action.dueAt);
  if (dueDate > day.localDate) return null;
  return dueDate < day.localDate ? "overdue" : "due_today";
}
