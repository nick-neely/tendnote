import { searchPeople } from "@tendnote/db";
import { searchPeopleSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";

export default defineTool({
  description:
    "Find people by name, relationship type, or recency. Returns stored Tendnote people only.",
  inputSchema: searchPeopleSchema,
  async execute(input) {
    const people = await searchPeople(input);

    return {
      people: people.map((person) => ({
        id: person.id,
        displayName: person.displayName,
        relationshipType: person.relationshipType,
        closenessLevel: person.closenessLevel,
        profileBlurb: person.profileBlurb,
      })),
    };
  },
});
