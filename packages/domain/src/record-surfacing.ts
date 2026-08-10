import type { FollowupStatus } from "./followups";
import { type GeneralActionStatus, startOfLocalDay } from "./general-actions";
import { type PrivacyScope, visibilityLabelForScope } from "./privacy";
import type { SavedItemStatus } from "./saved-items";

export type RecordSurfacingState =
  | "overdue"
  | "today"
  | "upcoming"
  | "unscheduled"
  | "deferred"
  | "paused";

export type RecordSurfacingContextInput = {
  /**
   * Null when the Household Workspace owns the record (ADR 0214), which makes
   * `owned` false for every viewer - nobody reads a household-native item as
   * "mine", and no member's controls are widened by having created it.
   */
  ownerUserId: string | null;
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
    }
  | {
      kind: "saved_item";
      status: SavedItemStatus;
      bringBackAt: Date | null;
    };

export type RecordSurfacingInput = RecordSurfacingContextInput & RecordTimingInput;

export type RecordSurfacing = {
  state: RecordSurfacingState;
  timingLabel: string;
  audienceLabel: string;
  owned: boolean;
  revision: string;
};

export type RecordSurfacingContext = Pick<RecordSurfacing, "audienceLabel" | "owned" | "revision">;

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
    ...resolveRecordContext(record),
  };
}

export function resolveRecordContext(record: RecordSurfacingContextInput): RecordSurfacingContext {
  return {
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
  if (record.kind === "saved_item" && record.status === "archived") {
    return { state: "unscheduled", timingLabel: "No date" };
  }
  const dueAt = record.kind === "saved_item" ? record.bringBackAt : record.dueAt;
  if (!dueAt) {
    return { state: "unscheduled", timingLabel: "No date" };
  }

  const due = startOfLocalDay(dueAt);
  const today = startOfLocalDay(now);
  const state = due < today ? "overdue" : due === today ? "today" : "upcoming";
  return {
    state,
    timingLabel:
      state === "overdue"
        ? `Was due ${formatSurfacingDay(dueAt, now)}`
        : state === "today"
          ? "Due today"
          : `Due ${formatSurfacingDay(dueAt, now)}`,
  };
}

function audienceLabel(record: RecordSurfacingContextInput): string {
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
