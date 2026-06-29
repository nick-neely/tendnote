import type { CalendarAttendee } from "@tendnote/domain";
import type { CalendarAttendeeMatch, CalendarPeopleMatcher } from "./types";

/**
 * Match a Calendar attendee to an existing Tendnote person (ADR-0078). Prefers the
 * stable email signal; a single display-name match is tentative. Ambiguous (multiple
 * matches) or no match resolves to unresolved/link-needed context. NEVER creates a
 * person, and never attaches a durable link for an unresolved attendee.
 */
export async function matchAttendee(
  ownerUserId: string,
  attendee: CalendarAttendee,
  matcher: CalendarPeopleMatcher,
): Promise<CalendarAttendeeMatch> {
  const unresolvedLabel = attendee.email ?? attendee.displayName ?? null;

  if (attendee.email) {
    const byEmail = await matcher.findPeopleByEmail(ownerUserId, attendee.email);
    // Exactly one email match is a confident, stable resolution.
    if (byEmail.length === 1 && byEmail[0]) {
      return {
        personId: byEmail[0].id,
        personDisplayName: byEmail[0].displayName,
        matchKind: "email",
        tentative: false,
        unresolvedAttendee: null,
      };
    }
    // Zero or multiple email matches → fall through; do not guess.
  }

  if (attendee.displayName) {
    const byName = await matcher.findPeopleByName(ownerUserId, attendee.displayName);
    // A single display-name match is tentative, never confident.
    if (byName.length === 1 && byName[0]) {
      return {
        personId: byName[0].id,
        personDisplayName: byName[0].displayName,
        matchKind: "display_name",
        tentative: true,
        unresolvedAttendee: null,
      };
    }
  }

  return {
    personId: null,
    personDisplayName: null,
    matchKind: "unresolved",
    tentative: false,
    unresolvedAttendee: unresolvedLabel,
  };
}
