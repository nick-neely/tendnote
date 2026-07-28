import type { FollowupStatus } from "./followups";
import { type GeneralActionStatus, startOfLocalDay } from "./general-actions";
import { type PrivacyScope, visibilityLabelForScope } from "./privacy";

export type RecordSurfacingState =
  | "overdue"
  | "today"
  | "upcoming"
  | "unscheduled"
  | "deferred"
  | "paused";

type SharedSurfacingInput = {
  ownerUserId: string;
  viewerUserId: string;
  scope: PrivacyScope;
  sharedWithCount: number;
  householdName: string | null;
  updatedAt: Date;
};

export type RecordTimingInput =
  | {
      kind: "general_action";
      status: GeneralActionStatus;
      dueAt: Date | null;
      deferUntil: Date | null;
    }
  | {
      kind: "followup";
      status: FollowupStatus;
      dueAt: Date;
    };

export type RecordSurfacingInput = SharedSurfacingInput & RecordTimingInput;

export type RecordSurfacing = {
  state: RecordSurfacingState;
  timingLabel: string;
  audienceLabel: string;
  owned: boolean;
  revision: string;
};

/**
 * One pure presentation vocabulary for records that surface in owner ledgers.
 *
 * This extends the General Action domain's existing local-day surfacing boundary
 * to Follow-Ups, then adds the shared audience, ownership, and revision facts.
 * Record-specific adapters retain only fields this contract does not know.
 */
export function resolveRecordSurfacing(record: RecordSurfacingInput, now: Date): RecordSurfacing {
  const timing = resolveRecordTiming(record, now);
  return {
    ...timing,
    audienceLabel: audienceLabel(record),
    owned: record.ownerUserId === record.viewerUserId,
    revision: record.updatedAt.toISOString(),
  };
}

export function resolveRecordTiming(
  record: RecordTimingInput,
  now: Date,
): Pick<RecordSurfacing, "state" | "timingLabel"> {
  if (record.kind === "general_action" && record.status === "paused") {
    return { state: "paused", timingLabel: "Paused" };
  }
  if (record.kind === "general_action" && record.status === "deferred" && record.deferUntil) {
    return {
      state: "deferred",
      timingLabel: `Set aside until ${formatSurfacingDay(record.deferUntil, now)}`,
    };
  }
  if (!record.dueAt) {
    return { state: "unscheduled", timingLabel: "No date" };
  }

  const due = startOfLocalDay(record.dueAt);
  const today = startOfLocalDay(now);
  const state = due < today ? "overdue" : due === today ? "today" : "upcoming";
  return {
    state,
    timingLabel:
      state === "overdue"
        ? `Was due ${formatSurfacingDay(record.dueAt, now)}`
        : state === "today"
          ? "Due today"
          : `Due ${formatSurfacingDay(record.dueAt, now)}`,
  };
}

function audienceLabel(record: SharedSurfacingInput): string {
  if (record.scope === "shared") {
    const base = visibilityLabelForScope(record.scope);
    return record.sharedWithCount > 0 ? `${base} · ${record.sharedWithCount}` : base;
  }
  if (record.scope === "household") {
    return record.householdName ?? visibilityLabelForScope(record.scope);
  }
  return visibilityLabelForScope(record.scope);
}

export function formatSurfacingDay(date: Date, now: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
