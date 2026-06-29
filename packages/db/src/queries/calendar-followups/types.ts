import type {
  CalendarAttendeeMatchKind,
  CalendarSuggestedFollowup,
  CalendarSuggestionShape,
  CalendarSuggestionStatus,
} from "@tendnote/domain";

/** A resolved (or unresolved) Tendnote person reference for an attendee. */
export type CalendarAttendeeMatch = {
  personId: string | null;
  personDisplayName: string | null;
  matchKind: CalendarAttendeeMatchKind;
  tentative: boolean;
  /** Email/name surfaced as link-needed context when unresolved, else null. */
  unresolvedAttendee: string | null;
};

/** A pre-persist suggestion candidate produced by the deterministic pipeline. */
export type CalendarSuggestionCandidate = CalendarAttendeeMatch & {
  providerEventId: string;
  calendarId: string;
  shape: CalendarSuggestionShape;
  reason: string;
  dueAt: Date;
  dedupeKey: string;
};

/** Owner-scoped people lookups for attendee matching (never auto-creates people). */
export type CalendarPeopleMatcher = {
  findPeopleByEmail: (
    ownerUserId: string,
    email: string,
  ) => Promise<{ id: string; displayName: string }[]>;
  findPeopleByName: (
    ownerUserId: string,
    displayName: string,
  ) => Promise<{ id: string; displayName: string }[]>;
};

/**
 * Optional LLM classifier (ADR-0082). It receives ONLY a bounded minimized summary
 * and may return a concise reason; it cannot create follow-ups, pick from unbounded
 * history, or bypass caps/review. Returning null keeps the deterministic reason.
 */
export type CalendarSuggestionClassifier = (input: {
  title: string;
  startsAt: string;
  withWhom: string | null;
}) => Promise<string | null>;

export type PersistCalendarSuggestionInput = {
  ownerUserId: string;
  providerEventId: string;
  calendarId: string;
  shape: CalendarSuggestionShape;
  personId: string | null;
  personDisplayName: string | null;
  matchKind: CalendarAttendeeMatchKind;
  tentative: boolean;
  unresolvedAttendee: string | null;
  reason: string;
  dueAt: Date;
  dedupeKey: string;
};

export type CalendarSuggestionAuditLogEntry = {
  ownerUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown>;
};

export type CalendarSuggestionStore = {
  /** Existing dedupe keys (any status) so dismissed/accepted are not re-suggested. */
  listExistingDedupeKeys: (ownerUserId: string) => Promise<Set<string>>;
  /** Returns null when a concurrent run already inserted this owner+dedupe key. */
  createSuggestion: (
    input: PersistCalendarSuggestionInput,
  ) => Promise<CalendarSuggestedFollowup | null>;
  getSuggestion: (input: {
    ownerUserId: string;
    id: string;
  }) => Promise<CalendarSuggestedFollowup | null>;
  listSuggestions: (input: {
    ownerUserId: string;
    status?: CalendarSuggestionStatus;
  }) => Promise<CalendarSuggestedFollowup[]>;
  updateSuggestion: (input: {
    ownerUserId: string;
    id: string;
    patch: {
      status?: CalendarSuggestionStatus;
      acceptedFollowupId?: string | null;
    };
  }) => Promise<CalendarSuggestedFollowup | null>;
  createAuditLogEntry: (entry: CalendarSuggestionAuditLogEntry) => Promise<void>;
};
