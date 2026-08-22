import { searchPeople } from "@tendnote/db/queries/people";
import { requiresPersonDisambiguation, searchPeopleSchema } from "@tendnote/domain";
import type { z } from "zod";
import { type OwnerScopedContext, resolveOwnerUserId } from "../owner";
import { withModelSafeStoreErrors } from "../store-errors";

/**
 * The shared identity lookup: the one way any agent node turns a name the user said
 * into the `personId` its next tool call needs. Owner-scoped from the session, and
 * deliberately incapable of creating anyone.
 */
const peopleSearch = {
  async execute(input: z.infer<typeof searchPeopleSchema>, ctx: OwnerScopedContext) {
    const ownerUserId = resolveOwnerUserId(ctx);
    let people = await withModelSafeStoreErrors(() => searchPeople({ ...input, ownerUserId }));

    // The model sometimes guesses a relationshipType for a plain name lookup,
    // which hides real matches (e.g. searching "Alex" with type "other" filters
    // out a friend named Alex). When a name query returns nothing under a type
    // filter, retry by name alone so a clear lookup still surfaces the person.
    if (people.length === 0 && input.query && input.relationshipType) {
      people = await withModelSafeStoreErrors(() =>
        searchPeople({ query: input.query, limit: input.limit, ownerUserId }),
      );
    }

    const matches = people.map((person) => ({
      id: person.id,
      displayName: person.displayName,
      // Relationship type can distinguish otherwise identical names. Profile and
      // closeness fields are context, not identity, and must stay behind their
      // visibility-aware read seams instead of entering the model through lookup.
      relationshipType: person.relationshipType,
    }));

    return {
      people: matches,
      // Deterministic disambiguation signal (ADR 0033): more than one candidate
      // means Eve must ask which person the user means, never guess or create.
      requiresDisambiguation: requiresPersonDisambiguation(matches),
    };
  },
};

/**
 * Registers the identity lookup for one agent node.
 *
 * Only the description varies, because only the caller's next step does: the root
 * agent may go on to create a person it could not find, and `relationship_strategist`
 * may not - it can only hand the ambiguity back. The read itself, the owner scoping,
 * the type-filter retry, and the disambiguation signal are the same for both.
 */
export function searchPeopleTool(options: { description: string }) {
  return {
    description: options.description,
    inputSchema: searchPeopleSchema,
    execute: peopleSearch.execute,
  };
}
