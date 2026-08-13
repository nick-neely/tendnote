import type { GeneralAction, HouseholdHomeRecord, HouseholdHomeTimingCode } from "@tendnote/domain";
import {
  describeRecurrence,
  HOUSEHOLD_HOME_COMING_UP_DAYS,
  householdRecordScopeLabel,
  responsibilityHolderLabel,
} from "@tendnote/domain";
import {
  classifyDatedAction,
  formatDateInZone,
  formatDateOnly,
} from "../../today/candidate-loaders/shared";
import type { HouseholdHomeCandidate, HouseholdHomeCandidateLoader } from "../types";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type HouseholdHomeActionDeps = {
  /**
   * The active Actions and Routines this member may currently see — their own
   * plus the household-native and shared ones. Scope filtering happens in the
   * store, and the composition proves each row again before it is shown.
   */
  listVisibleActions: (input: { callerUserId: string; limit: number }) => Promise<GeneralAction[]>;
};

/** Bounded like Today's: a shortlist reads a window, never the whole ledger. */
const ACTION_WINDOW = 40;

/**
 * Actions and Routines on the Household home.
 *
 * Both ownership forms compose: a household-native chore and a member-owned
 * Action deliberately shared into the household. A member's own private records
 * never do — the home answers what *we* are coordinating, and a private errand is
 * not part of that answer even for the member who owns it.
 *
 * An undated Action does not compose either. "Ready now" is a shortlist of
 * what is asking for the household now, and an Action with no date is asking for
 * nothing in particular; admitting them would turn the section into the second
 * task backlog the home is explicitly not allowed to become. They stay on
 * Actions, which the section links to.
 */
export async function loadHouseholdActionCandidates(
  deps: HouseholdHomeActionDeps,
  input: Parameters<HouseholdHomeCandidateLoader>[0],
): Promise<HouseholdHomeCandidate[]> {
  const actions = await deps.listVisibleActions({
    callerUserId: input.callerUserId,
    limit: ACTION_WINDOW,
  });
  const candidates: HouseholdHomeCandidate[] = [];
  for (const action of actions) {
    if (action.scope === "private" || action.householdId !== input.householdId) continue;
    const timing = classifyHouseholdHomeAction(action, input);
    if (!timing) continue;
    candidates.push({
      facts: {
        kind: "general_action",
        id: action.id,
        ownerUserId: action.ownerUserId,
        scope: action.scope,
        householdId: action.householdId,
        ownership: action.ownership,
      },
      record: householdHomeRecord(action, timing, input),
    });
  }
  return candidates;
}

type ActionTiming = {
  code: HouseholdHomeTimingCode;
  at: Date;
};

/**
 * Where a record sits on the home.
 *
 * The classification itself is shared with private Today, so one record's
 * moment cannot mean two things on two surfaces. What the home adds is its own
 * answer to the one branch the two surfaces disagree about: a date that has not
 * arrived belongs in **Coming up** if it falls inside the household's horizon,
 * and stays on Actions if it does not.
 *
 * Deterministic and identical for every member: it reads the record and the
 * day, never who is asking. A paused Routine never reaches here — pausing takes
 * the shared occurrence out of the active listing, and with it the home and
 * every member's Today (#383).
 */
function classifyHouseholdHomeAction(
  action: Pick<GeneralAction, "status" | "dueAt" | "deferUntil">,
  day: { localDate: string; now: Date },
): ActionTiming | null {
  const timing = classifyDatedAction(action, day);
  if (!timing) return null;
  if (timing.code !== "scheduled") return timing;
  return timing.at.getTime() <= day.now.getTime() + HOUSEHOLD_HOME_COMING_UP_DAYS * DAY_MS
    ? timing
    : null;
}

function householdHomeRecord(
  action: GeneralAction,
  timing: ActionTiming,
  input: Parameters<HouseholdHomeCandidateLoader>[0],
): HouseholdHomeRecord {
  const routine = action.recurrence !== null;
  const holderUserId = action.responsibilityHolderUserId;
  return {
    identity: `${routine ? "routine" : "action"}:${action.id}`,
    family: routine ? "routine" : "action",
    section: timing.code === "scheduled" ? "coming_up" : "needs_attention",
    // Only a date the household has already reached is pressing. A resurfaced
    // record came back because someone chose to put it down, so it earns a place
    // in the section without earning the extra room an overdue chore does.
    pressing: timing.code === "overdue" || timing.code === "due_today",
    record: {
      kind: "general_action",
      id: action.id,
      href: `/actions#action-${action.id}`,
    },
    title: action.title,
    context:
      routine && action.recurrence
        ? `Routine · ${describeRecurrence(action.recurrence)}`
        : "Action",
    timing: {
      code: timing.code,
      explanation: explainTiming(timing, input.timeZone),
    },
    scopeLabel: householdRecordScopeLabel({
      ownership: action.ownership,
      ownerName: input.memberNames.get(action.ownerUserId) ?? null,
      isSelf: action.ownership === "member_owned" && action.ownerUserId === input.callerUserId,
    }),
    responsibility: holderUserId
      ? responsibilityHolderLabel({
          holderName: input.memberNames.get(holderUserId) ?? null,
          isSelf: holderUserId === input.callerUserId,
        })
      : null,
    progress: {
      kind: "complete_record",
      // The Actions surface's own words, per record type, so one record's
      // control reads identically wherever a member meets it: a Routine is only
      // ever done for now, and saying "Complete" of one would claim more.
      label: routine ? "Done for now" : "Complete",
      expectedOccurrenceVersion: action.occurrenceVersion,
    },
    at: timing.at,
    createdAt: action.createdAt,
  };
}

/**
 * The sentence a member reads under the record.
 *
 * Never "overdue", "late", or "missed": two people share this surface, and a
 * word that assigns fault to a date turns a shared home into a scoreboard
 * (DESIGN.md §9). The same phrasing Today uses, so one record reads the same
 * wherever it appears.
 */
function explainTiming(timing: ActionTiming, timeZone: string): string {
  switch (timing.code) {
    case "overdue":
      return `Waiting since ${formatDateOnly(timing.at)}.`;
    case "due_today":
      return "Due today.";
    case "resurfaced":
      return `Set to return ${formatDateInZone(timing.at, timeZone)}.`;
    case "scheduled":
      return `Due ${formatDateInZone(timing.at, timeZone)}.`;
  }
}
