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
  ownerUserId: string;
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
  ownerUserId: string;
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

export function canViewScopedRecord(input: {
  callerUserId: string;
  record: ScopedRecordVisibility;
  activeMemberships: readonly ActiveHouseholdAccess[];
}): boolean {
  if (input.record.scope === "private") {
    return input.callerUserId === input.record.ownerUserId;
  }

  if (!input.record.householdId) {
    return false;
  }

  const activeInHousehold = input.activeMemberships.some(
    (membership) =>
      membership.householdId === input.record.householdId &&
      membership.userId === input.callerUserId,
  );
  if (!activeInHousehold) {
    return false;
  }

  if (input.record.scope === "household") {
    return true;
  }

  return (
    input.callerUserId === input.record.ownerUserId ||
    input.record.sharedWithUserIds?.includes(input.callerUserId) === true
  );
}
