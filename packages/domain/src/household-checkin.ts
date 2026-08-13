import type { HouseholdCoordinationRecord } from "./household-home";

/**
 * At most three, and never a fourth.
 *
 * The cap is the product, not a performance budget. A Household Check-in exists so
 * an active member can notice a couple of time-sensitive shared things inside their
 * own briefing; a list that grows with the household is a second backlog, and a
 * backlog delivered into someone's private brief is the shared digest this phase
 * refuses (ADR 0220). Three is also the number the decision doc names.
 */
export const HOUSEHOLD_CHECKIN_MAX_RECORDS = 3;

export const HOUSEHOLD_CHECKIN_HEADING = "Household check-in";

/**
 * What the member is told when the whole read could not be made.
 *
 * It says what changed for them and nothing about which family failed, and it is
 * deliberately not the empty state's words: "nothing to check in on" and "we could
 * not look" are different facts, and a member reading the wrong one would believe
 * a shared chore had been dealt with.
 */
export const HOUSEHOLD_CHECKIN_UNAVAILABLE =
  "The check-in is temporarily unavailable. Your household's records are unchanged.";

export type HouseholdCheckinComposition = {
  records: HouseholdCoordinationRecord[];
  limitations: string[];
};

/**
 * The bounded, already-proved set a Check-in may present.
 *
 * Everything about this function is deliberately deterministic and pre-generative.
 * The decision doc puts eligibility and caps *outside* the model: a Check-in is a
 * caller-specific read of canonical records, so the selection is made here, from
 * timing alone, and a model may only summarize the set it is handed. Stable
 * ordering is therefore also the fallback when no generation happens at all —
 * there is nothing to fall back from, because the list was never generated.
 *
 * The input is records the caller has already been proved to see. This function
 * takes no caller, no membership, and no household id, so there is no argument by
 * which it could widen anything: it can only shorten a list someone else proved.
 */
export function composeHouseholdCheckin(input: {
  records: readonly HouseholdCoordinationRecord[];
  limitations?: readonly string[];
}): HouseholdCheckinComposition {
  const byIdentity = new Map<string, HouseholdCoordinationRecord>();
  for (const record of input.records) {
    if (!byIdentity.has(record.identity)) byIdentity.set(record.identity, record);
  }

  return {
    records: [...byIdentity.values()]
      .sort(compareCheckinRecords)
      .slice(0, HOUSEHOLD_CHECKIN_MAX_RECORDS),
    limitations: [...new Set(input.limitations ?? [])],
  };
}

/**
 * Pressing things first, then soonest, then by identity.
 *
 * The identity tie-break is what makes the order stable rather than whichever the
 * database happened to return first — a Check-in that reshuffled between two reads
 * of the same state would read as activity, and there is no activity here.
 *
 * `pressing` outranks time so that a chore already asking something of the
 * household is not pushed below a dated one that is merely nearer. It is a
 * selection input only: the row never renders it as a badge, a colour, or a
 * severity, because "this is urgent for you" is precisely the personal obligation
 * a shared record must not manufacture.
 */
function compareCheckinRecords(
  left: HouseholdCoordinationRecord,
  right: HouseholdCoordinationRecord,
): number {
  if (left.pressing !== right.pressing) return left.pressing ? -1 : 1;
  return left.at.getTime() - right.at.getTime() || left.identity.localeCompare(right.identity);
}

/**
 * Whether the entry should appear at all.
 *
 * Absence is the honest state. If no current candidate is useful the entry is
 * omitted rather than shown empty: an empty Check-in is a small standing request
 * to go and find something, which is the manufactured task the decision doc rules
 * out. A failed read is different and does show, because "we could not look" is
 * something the member needs to know.
 */
export function householdCheckinIsWorthShowing(composition: HouseholdCheckinComposition): boolean {
  return composition.records.length > 0 || composition.limitations.length > 0;
}
