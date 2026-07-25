"use server";

import { listActiveFollowups } from "@tendnote/db/queries/followups";
import { searchPeople } from "@tendnote/db/queries/people";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { suggestComposerPerson } from "@/lib/composer-suggestion";
import { getCalendarPromptNudgesForOwner } from "@/lib/integrations/calendar-prompt-nudges";

const EVE_CONTEXT_PERSON_LIMIT = 8;
const EVE_CONTEXT_FOLLOWUP_LIMIT = 5;

/**
 * Loads only the small, owner-scoped contextual hints the mobile Eve composer
 * displays. It is an explicit-interaction action: no route render or prefetch
 * invokes it, and authority is always resolved on the server.
 */
export async function loadMobileEveContextAction() {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const [people, followups, nudges] = await Promise.all([
    searchPeople({ ownerUserId, limit: EVE_CONTEXT_PERSON_LIMIT }),
    listActiveFollowups({ ownerUserId, limit: EVE_CONTEXT_FOLLOWUP_LIMIT }),
    getCalendarPromptNudgesForOwner(ownerUserId),
  ]);
  return {
    nudges,
    suggestPersonName: suggestComposerPerson(
      followups.map(({ person }) => ({ personName: person?.displayName ?? null })),
      people,
    ),
  };
}
