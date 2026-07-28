"use server";

import { listActiveFollowups } from "@tendnote/db/queries/followups";
import { searchPeople } from "@tendnote/db/queries/people";
import { z } from "zod";
import { suggestComposerPerson } from "@/lib/composer-suggestion";
import { getCalendarPromptNudgesForOwner } from "@/lib/integrations/calendar-prompt-nudges";
import { runOwnerAction } from "@/lib/owner-action";

const EVE_CONTEXT_PERSON_LIMIT = 8;
const EVE_CONTEXT_FOLLOWUP_LIMIT = 5;

/**
 * Loads only the small, owner-scoped contextual hints the mobile Eve composer
 * displays. It is an explicit-interaction action: no route render or prefetch
 * invokes it, and authority is always resolved on the server.
 */
export async function loadMobileEveContextAction() {
  return runOwnerAction({
    schema: z.undefined(),
    input: undefined,
    body: async ({ ownerUserId }) => {
      const [people, followups, nudges] = await Promise.all([
        searchPeople({ ownerUserId, limit: EVE_CONTEXT_PERSON_LIMIT }),
        listActiveFollowups({ ownerUserId, limit: EVE_CONTEXT_FOLLOWUP_LIMIT }),
        getCalendarPromptNudgesForOwner(ownerUserId),
      ]);
      return { people, followups, nudges };
    },
    result: ({ followups, nudges, people }) => ({
      nudges,
      suggestPersonName: suggestComposerPerson(
        followups.map(({ person }) => ({ personName: person?.displayName ?? null })),
        people,
      ),
    }),
  });
}
