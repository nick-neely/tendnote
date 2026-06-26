import { searchPeople } from "@tendnote/db/queries/people";
import { requiresPersonDisambiguation, searchPeopleSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Find people before linking context or adding anyone. Pass the name the user mentioned as `query`. Only set `relationshipType` when the user explicitly asks to filter by a relationship category (e.g. 'my colleagues'); never guess or default it, because a wrong type filters out real matches. Omit it for plain name lookups. Returns stored Tendnote people plus requiresDisambiguation: when true, more than one person matched, so ask the user which one they mean instead of guessing or creating a new person.",
  inputSchema: searchPeopleSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    let people = await searchPeople({ ...input, ownerUserId });

    // The model sometimes guesses a relationshipType for a plain name lookup,
    // which hides real matches (e.g. searching "Alex" with type "other" filters
    // out a friend named Alex). When a name query returns nothing under a type
    // filter, retry by name alone so a clear lookup still surfaces the person.
    if (people.length === 0 && input.query && input.relationshipType) {
      people = await searchPeople({ query: input.query, limit: input.limit, ownerUserId });
    }

    const matches = people.map((person) => ({
      id: person.id,
      displayName: person.displayName,
      relationshipType: person.relationshipType,
      closenessLevel: person.closenessLevel,
      profileBlurb: person.profileBlurb,
    }));

    return {
      people: matches,
      // Deterministic disambiguation signal (ADR 0033): more than one candidate
      // means Eve must ask which person the user means, never guess or create.
      requiresDisambiguation: requiresPersonDisambiguation(matches),
    };
  },
});
