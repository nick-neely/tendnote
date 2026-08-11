import { z } from "zod";

/**
 * A user-actionable failure from a Household Workspace admission or capacity
 * decision. Its `message` is curated and safe to show the caller, mirroring
 * `GeneralActionValidationError` so surfaces render it inline rather than as a
 * generic error.
 */
export class HouseholdValidationError extends Error {
  override name = "HouseholdValidationError";
}

/**
 * The caller is already active in a Household Workspace, so a second active
 * workspace cannot be created or entered.
 *
 * The message deliberately says nothing about the household the caller already
 * belongs to, and nothing about the workspace they tried to enter. Admission
 * conflicts are explained privately: naming either side would leak membership
 * state across households (ADR 0213).
 */
export class HouseholdAdmissionConflictError extends HouseholdValidationError {
  override name = "HouseholdAdmissionConflictError";
}

/**
 * The eight-seat policy, in one place.
 *
 * It is a product policy rather than a database constraint on purpose: the
 * number is expected to change, and a live invitation reserves a seat without
 * being a membership, which no single table can express (ADR 0213).
 */
export const HOUSEHOLD_SEAT_LIMIT = 8;

/**
 * How long a household name may be. Exported so the surface that bounds its
 * input and the schema that enforces the rule read the same number: two copies
 * of "60" drift, and the drift shows up as an input that silently accepts a name
 * the server then rejects.
 */
export const HOUSEHOLD_NAME_LIMIT = 60;

export const householdNameSchema = z
  .string()
  .trim()
  .min(1, "Give the household a name.")
  .max(
    HOUSEHOLD_NAME_LIMIT,
    `Keep the household name to ${HOUSEHOLD_NAME_LIMIT} characters or fewer.`,
  );

/** Parses a household name, raising the curated message a surface can render. */
export function parseHouseholdName(name: string): string {
  const parsed = householdNameSchema.safeParse(name);
  if (!parsed.success) {
    throw new HouseholdValidationError(
      parsed.error.issues[0]?.message ?? "Give the household a name.",
    );
  }
  return parsed.data;
}

export type HouseholdSeatUsage = {
  limit: number;
  /** Active members plus live invitations. */
  occupied: number;
  remaining: number;
  isFull: boolean;
};

export type HouseholdSeatInput = {
  activeMembers: number;
  liveInvitations?: number;
};

export function householdSeatUsage(input: HouseholdSeatInput): HouseholdSeatUsage {
  const occupied = input.activeMembers + (input.liveInvitations ?? 0);
  return {
    limit: HOUSEHOLD_SEAT_LIMIT,
    occupied,
    remaining: Math.max(0, HOUSEHOLD_SEAT_LIMIT - occupied),
    isFull: occupied >= HOUSEHOLD_SEAT_LIMIT,
  };
}

/** The one gate every seat-consuming operation passes through. */
export function assertHouseholdSeatAvailable(input: HouseholdSeatInput): HouseholdSeatUsage {
  const usage = householdSeatUsage(input);
  if (usage.isFull) {
    throw new HouseholdValidationError(
      `This household is full. It holds up to ${HOUSEHOLD_SEAT_LIMIT} people, counting anyone with a live invitation.`,
    );
  }
  return usage;
}

/**
 * The one-active-workspace admission rule. A user holds at most one active
 * Household Membership, so creating or entering a workspace is refused while
 * another active membership exists rather than silently switching context.
 */
export function assertHouseholdAdmissionAvailable(
  activeMemberships: readonly { householdId: string }[],
): void {
  if (activeMemberships.length > 0) {
    throw new HouseholdAdmissionConflictError(
      "You're already in a household. Tendnote keeps you in one household at a time, so nothing here has changed.",
    );
  }
}
