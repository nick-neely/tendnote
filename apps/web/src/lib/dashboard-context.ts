import "server-only";

import { listCalendarSuggestedFollowups } from "@tendnote/db/queries/calendar-followups";
import { listActiveFollowups, listSuggestedFollowupReviews } from "@tendnote/db/queries/followups";
import { searchPeople } from "@tendnote/db/queries/people";
import {
  calendarSuggestionToPromptNudge,
  PROMPT_NUDGE_DISPLAY_CAP,
  type PromptNudge,
} from "@tendnote/domain";
import { cache } from "react";
import { suggestComposerPerson } from "@/lib/composer-suggestion";

/**
 * The dashboard's owner-scoped reads, shared by its independently streamed
 * regions. The assistant column and the context rail both need the owner's
 * people, reminders, and Calendar suggestions; each region awaits them behind
 * its own Suspense boundary, so without a request-scoped memo the same query
 * would run once per region. `cache()` collapses that to one read per request
 * while keeping the boundaries independent — neither region waits on the other.
 *
 * A reader only swallows a failure where an empty result says nothing about the
 * owner's records — no reminders waiting is indistinguishable from a few. The
 * owner's people are not like that: an empty list is a claim ("no people yet"), so
 * that read is allowed to fail and reach the rail's error boundary rather than
 * quietly telling the owner their notebook is empty.
 */

// A handful of the soonest active reminders — a calm prompt, not a task feed (#45).
const DASHBOARD_FOLLOWUP_LIMIT = 5;
const DASHBOARD_PEOPLE_LIMIT = 8;

function warn(what: string, error: unknown): void {
  if (process.env.NODE_ENV !== "production") console.warn(`Unable to load ${what}.`, error);
}

export const dashboardPeople = cache(async (ownerUserId: string) => {
  // Deliberately not caught — see the module note.
  return searchPeople({ ownerUserId, limit: DASHBOARD_PEOPLE_LIMIT });
});

export const dashboardActiveFollowups = cache(async (ownerUserId: string) => {
  try {
    // The soonest active reminders across people, due-first, each named by person.
    return await listActiveFollowups({ ownerUserId, limit: DASHBOARD_FOLLOWUP_LIMIT });
  } catch (error) {
    warn("active follow-ups", error);
    return [];
  }
});

export const dashboardSuggestedFollowups = cache(async (ownerUserId: string) => {
  try {
    // A few of the soonest suggested follow-ups across people, for inline review.
    return await listSuggestedFollowupReviews({ ownerUserId, limit: DASHBOARD_FOLLOWUP_LIMIT });
  } catch (error) {
    warn("suggested follow-ups", error);
    return [];
  }
});

export const dashboardCalendarSuggestions = cache(async (ownerUserId: string) => {
  try {
    const suggestions = await listCalendarSuggestedFollowups(ownerUserId);
    return suggestions.slice(0, DASHBOARD_FOLLOWUP_LIMIT);
  } catch (error) {
    warn("Calendar suggested follow-ups", error);
    return [];
  }
});

/**
 * The assistant's two cosmetic hints. Neither starts a conversation or reaches a
 * provider: the nudges are Calendar suggestions the owner already has waiting,
 * and the name only makes the composer placeholder concrete — it is never a
 * fixture, so an empty notebook is never told about someone it has no record of.
 */
export async function dashboardAssistantHints(ownerUserId: string): Promise<{
  nudges: PromptNudge[];
  suggestPersonName: string | null;
}> {
  const [people, followups, calendarSuggestions] = await Promise.all([
    // Both hints are decoration. The composer has to be typeable even when a hint
    // cannot be resolved, so a failed read here costs a placeholder, never the
    // assistant — including the people read the rail is right to fail on.
    dashboardPeople(ownerUserId).catch((error) => {
      warn("people", error);
      return [];
    }),
    dashboardActiveFollowups(ownerUserId),
    dashboardCalendarSuggestions(ownerUserId),
  ]);

  return {
    nudges: calendarSuggestions
      .slice(0, PROMPT_NUDGE_DISPLAY_CAP)
      .map(calendarSuggestionToPromptNudge),
    suggestPersonName: suggestComposerPerson(
      followups.map(({ person }) => ({ personName: person?.displayName ?? null })),
      people,
    ),
  };
}
