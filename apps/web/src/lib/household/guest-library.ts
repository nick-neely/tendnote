import "server-only";

import { getGuestLibrary } from "@tendnote/db/queries/guest-library";
import type { GuestLibraryCandidate } from "@tendnote/domain/guest-library";
import { readHouseholdCalendarSurface } from "@/lib/household/household-shared-data";
import { formatEventWhen } from "@/lib/integrations/calendar-preview";

/**
 * Household Calendar Events for the guest library: the same bounded read of the
 * household's designated calendars a member's Household page makes, keyed on
 * the guest's own membership. A calendar that could not be read makes the shelf
 * unavailable rather than quietly shorter.
 */
async function listGuestCalendarEvents(input: {
  callerUserId: string;
}): Promise<GuestLibraryCandidate[]> {
  const { read } = await readHouseholdCalendarSurface(input.callerUserId);
  return read.families.flatMap((family) => {
    if (family.state === "unavailable") {
      throw new Error("A household calendar could not be read.");
    }
    return family.events
      .filter((event) => event.status !== "cancelled")
      .map((event) => ({
        id: `${family.connectionId}:${event.calendarId}:${event.providerEventId}`,
        title: event.title?.trim() ? event.title : "Untitled event",
        // The household surfaces' own "when" wording, so a time reads the same here.
        context: `${formatEventWhen(event.start, event.allDay)} · ${family.label}`,
        body: [event.location, event.description].filter(Boolean).join("\n\n") || null,
        belongsTo: null,
        date: event.start,
        scope: "household" as const,
        householdNative: true,
        viewerIsOwner: false,
      }));
  });
}

/** The Household Guest's library, read fresh for this request (#636). */
export function readGuestLibrary(guestUserId: string) {
  return getGuestLibrary({ guestUserId, listCalendarEvents: listGuestCalendarEvents });
}
