import "server-only";

import { listCalendarSuggestedFollowups } from "@tendnote/db/queries/calendar-followups";
import {
  calendarSuggestionToPromptNudge,
  PROMPT_NUDGE_DISPLAY_CAP,
  type PromptNudge,
} from "@tendnote/domain";
import { requireAdmittedOwner } from "@/lib/access/current-access";

/**
 * Calendar-derived prompt nudges for the admitted owner (Phase 2C, #114). Maps the
 * owner's reviewable Calendar suggested follow-ups into a calm few generic prompt
 * nudges. Best-effort: any read failure yields no nudges so the assistant surface
 * never breaks. Phase 2C populates ONLY Calendar-derived nudges.
 */
export async function getOwnerCalendarPromptNudges(): Promise<PromptNudge[]> {
  const ownerUserId = await requireAdmittedOwner();
  try {
    const suggestions = await listCalendarSuggestedFollowups(ownerUserId);
    return suggestions.slice(0, PROMPT_NUDGE_DISPLAY_CAP).map(calendarSuggestionToPromptNudge);
  } catch {
    return [];
  }
}
