import { searchPeople } from "@tendnote/db/queries/people";
import { requiresPersonDisambiguation, searchPeopleSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Find people by name, relationship type, or recency before linking context or adding anyone. Returns stored Tendnote people plus requiresDisambiguation: when true, more than one person matched, so ask the user which one they mean instead of guessing or creating a new person.",
  inputSchema: searchPeopleSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const people = await searchPeople({ ...input, ownerUserId });
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
