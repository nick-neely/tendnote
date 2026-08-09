import { z } from "zod";

export const privacyScopeSchema = z.enum(["private", "shared", "household"]);
export type PrivacyScope = z.infer<typeof privacyScopeSchema>;

export const visibilityChoiceSchema = z.enum(["only_me", "selected_members", "whole_household"]);
export type VisibilityChoice = z.infer<typeof visibilityChoiceSchema>;

export const VISIBILITY_CONTROL_OPTIONS: ReadonlyArray<{
  choice: VisibilityChoice;
  scope: PrivacyScope;
  label: string;
  description: string;
}> = [
  {
    choice: "only_me",
    scope: "private",
    label: "Only me",
    description: "Visible only to the person who owns this record.",
  },
  {
    choice: "selected_members",
    scope: "shared",
    label: "Specific people",
    description: "Visible to selected active household members.",
  },
  {
    choice: "whole_household",
    scope: "household",
    label: "Whole household",
    description: "Visible to every active household member, including future members.",
  },
];

export function scopeForVisibilityChoice(choice: VisibilityChoice): PrivacyScope {
  return VISIBILITY_CONTROL_OPTIONS.find((option) => option.choice === choice)?.scope ?? "private";
}

export function visibilityChoiceForScope(scope: PrivacyScope): VisibilityChoice {
  return visibilityOptionForScope(scope).choice;
}

export function visibilityLabelForScope(scope: PrivacyScope): string {
  return visibilityOptionForScope(scope).label;
}

function visibilityOptionForScope(scope: PrivacyScope) {
  const fallback = VISIBILITY_CONTROL_OPTIONS[0];
  if (!fallback) {
    throw new Error("Visibility control options must include a private default.");
  }

  return VISIBILITY_CONTROL_OPTIONS.find((option) => option.scope === scope) ?? fallback;
}

export const sensitivitySchema = z.enum(["normal", "sensitive", "restricted"]);
export type Sensitivity = z.infer<typeof sensitivitySchema>;

const SENSITIVITY_RANK: Record<Sensitivity, number> = { normal: 1, sensitive: 2, restricted: 3 };

/**
 * How far up the escalation the level sits. Every producer that derives a
 * sensitivity has to be able to raise one and never lower it, so the ordering
 * lives here rather than being restated beside each of them.
 */
export function sensitivityRank(value: Sensitivity): number {
  return SENSITIVITY_RANK[value];
}

/** The stricter of the two, so inference can preserve or raise but never downgrade. */
export function atLeastSensitivity(floor: Sensitivity, candidate: Sensitivity | undefined) {
  return !candidate || sensitivityRank(candidate) < sensitivityRank(floor) ? floor : candidate;
}

export const confidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const sourceSchema = z.enum([
  "manual",
  "agent",
  "contact_import",
  "calendar",
  "gmail",
  "seed",
]);
export type Source = z.infer<typeof sourceSchema>;

export const retrievalSurfaceSchema = z.enum(["profile", "review", "proactive", "direct_request"]);
export type RetrievalSurface = z.infer<typeof retrievalSurfaceSchema>;

export function canUseSensitiveContext(input: {
  sensitivity: Sensitivity;
  directlyRequested?: boolean;
}) {
  return input.sensitivity !== "restricted" || input.directlyRequested === true;
}

export function canUseMemoryInBrief(input: {
  sensitivity: Sensitivity;
  directlyRequested?: boolean;
}) {
  return input.sensitivity === "normal" || input.directlyRequested === true;
}

export type ScopedRecordVisibility = {
  /**
   * Null when the Household Workspace owns the record rather than a member
   * (ADR 0214). Nothing equals null here, so a workspace-owned record can never
   * qualify a caller as its owner: it reaches its audience through the household
   * branch or not at all, and a `private` one reaches nobody.
   */
  ownerUserId: string | null;
  scope: PrivacyScope;
  householdId: string | null;
  sharedWithUserIds?: readonly string[];
};

export type ScopedRecordShare = {
  sharedWithUserId: string;
};

export type ActiveHouseholdAccess = {
  householdId: string;
  userId: string;
};

export function scopedRecordVisibility(input: {
  ownerUserId: string | null;
  scope: PrivacyScope;
  householdId: string | null;
  shares?: readonly ScopedRecordShare[];
}): ScopedRecordVisibility {
  return {
    ownerUserId: input.ownerUserId,
    scope: input.scope,
    householdId: input.householdId,
    sharedWithUserIds: input.shares?.map((share) => share.sharedWithUserId),
  };
}

/**
 * Which form of standing let the caller through, or why nothing did.
 *
 * `via` is the ownership/audience form the Household Authorization Proof records
 * as its evidence; `reason` is audit-side only. Neither is a message: every
 * denial has to look identical to a caller, so surfaces branch on `visible`
 * alone (ADR 0219).
 */
export type ScopedRecordAudience =
  | { visible: true; via: "owner" | "household_audience" | "selected_audience" }
  | {
      visible: false;
      reason: "not_owner" | "no_household" | "not_active_member" | "not_in_audience";
    };

/**
 * The one audience rule: private is owner-only, a non-private scope needs the
 * caller's own current active membership in exactly the record's household, and
 * `shared` additionally needs the caller to be the owner or explicitly selected.
 *
 * It answers *how* the caller qualified rather than just whether, because the
 * proof above it has to record the ownership form it relied on — and because a
 * second copy of this rule written to produce that detail would be a second
 * chance to get household privacy wrong.
 */
export function scopedRecordAudience(input: {
  callerUserId: string;
  record: ScopedRecordVisibility;
  activeMemberships: readonly ActiveHouseholdAccess[];
}): ScopedRecordAudience {
  const isOwner = input.callerUserId === input.record.ownerUserId;
  if (input.record.scope === "private") {
    return isOwner ? { visible: true, via: "owner" } : { visible: false, reason: "not_owner" };
  }

  if (!input.record.householdId) {
    return { visible: false, reason: "no_household" };
  }

  const activeInHousehold = input.activeMemberships.some(
    (membership) =>
      membership.householdId === input.record.householdId &&
      membership.userId === input.callerUserId,
  );
  if (!activeInHousehold) {
    return { visible: false, reason: "not_active_member" };
  }

  if (isOwner) {
    return { visible: true, via: "owner" };
  }

  if (input.record.scope === "household") {
    return { visible: true, via: "household_audience" };
  }

  return input.record.sharedWithUserIds?.includes(input.callerUserId)
    ? { visible: true, via: "selected_audience" }
    : { visible: false, reason: "not_in_audience" };
}

export function canViewScopedRecord(input: {
  callerUserId: string;
  record: ScopedRecordVisibility;
  activeMemberships: readonly ActiveHouseholdAccess[];
}): boolean {
  return scopedRecordAudience(input).visible;
}
