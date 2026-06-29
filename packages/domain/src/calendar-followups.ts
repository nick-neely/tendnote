import { z } from "zod";

/**
 * Calendar-derived suggested follow-ups (Phase 2C, ADR-0077, ADR-0078, ADR-0082).
 *
 * Proactive, deterministic-first suggestions from recent meetings. They are capped,
 * deduped by owner + provider event identity + calendar + person/contact signal +
 * shape, and persisted as `suggested` — never active reminders until the user
 * accepts them. Attendees are matched to EXISTING Tendnote people by stable signals
 * (email preferred; display name tentative); they never auto-create people. Accept
 * promotes through the existing follow-up lifecycle; dismiss prevents normal
 * reintroduction via the dedupe key.
 */

export const calendarSuggestionStatusSchema = z.enum(["suggested", "accepted", "dismissed"]);
export type CalendarSuggestionStatus = z.infer<typeof calendarSuggestionStatusSchema>;

/** How an attendee resolved to a Tendnote person (or didn't). */
export const calendarAttendeeMatchKindSchema = z.enum(["email", "display_name", "unresolved"]);
export type CalendarAttendeeMatchKind = z.infer<typeof calendarAttendeeMatchKindSchema>;

/** The suggestion shape — kept generic so future shapes reuse the dedupe model. */
export const calendarSuggestionShapeSchema = z.enum(["post_meeting_followup"]);
export type CalendarSuggestionShape = z.infer<typeof calendarSuggestionShapeSchema>;

/** Caps so proactive suggestions never become noisy (ADR-0077). */
export const CALENDAR_SUGGESTION_MAX_PER_RUN = 5;
export const CALENDAR_SUGGESTION_REASON_MAX = 280;

/**
 * A persisted Calendar-derived suggested follow-up. `personId` is set only for a
 * resolved person (email or confident display-name match); an unresolved attendee
 * is surfaced via `unresolvedAttendee` with `personId = null` and no durable link.
 */
export const calendarSuggestedFollowupSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  providerEventId: z.string().min(1),
  calendarId: z.string().min(1),
  shape: calendarSuggestionShapeSchema,
  /** Resolved Tendnote person, or null when the attendee is unresolved. */
  personId: z.string().nullable(),
  personDisplayName: z.string().nullable(),
  matchKind: calendarAttendeeMatchKindSchema,
  /** True for display-name (tentative) matches; email matches are confident. */
  tentative: z.boolean(),
  /** Email/name for an unresolved attendee (link-needed context), else null. */
  unresolvedAttendee: z.string().nullable(),
  reason: z.string().min(1).max(CALENDAR_SUGGESTION_REASON_MAX),
  dueAt: z.date(),
  /** Stable dedupe key (see calendarSuggestionDedupeKey). Unique per owner. */
  dedupeKey: z.string().min(1),
  status: calendarSuggestionStatusSchema,
  /** The active follow-up created on accept, else null. */
  acceptedFollowupId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CalendarSuggestedFollowup = z.infer<typeof calendarSuggestedFollowupSchema>;

/**
 * Stable dedupe key: owner + provider event identity + calendar + person/contact
 * signal + shape. The person signal is the resolved person id when matched, else
 * the unresolved attendee identity, else "none" — so the same meeting never yields
 * repeated nudges for the same person, and a dismissed key is never re-suggested.
 */
export function calendarSuggestionDedupeKey(input: {
  providerEventId: string;
  calendarId: string;
  personId?: string | null;
  unresolvedAttendee?: string | null;
  shape: CalendarSuggestionShape;
}): string {
  const personSignal = input.personId ?? input.unresolvedAttendee ?? "none";
  // JSON-encoded so a delimiter character inside any component can never collide
  // two distinct signals (e.g. a name or calendar id containing a separator).
  return JSON.stringify([input.providerEventId, input.calendarId, personSignal, input.shape]);
}
