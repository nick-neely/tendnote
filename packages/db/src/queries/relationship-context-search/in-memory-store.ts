import type { ExactRecallResult, Person } from "@tendnote/domain";
import type { RelationshipContextSearchStore } from "./types";

export type InMemoryRelationshipContextSearchSeed = {
  people?: Person[];
};

export function createInMemoryRelationshipContextSearchStore(
  seed: InMemoryRelationshipContextSearchSeed = {},
): RelationshipContextSearchStore {
  const people = seed.people ?? [];

  return {
    async searchRelationshipContext(input) {
      const kinds = new Set(input.recordKinds ?? ["person"]);
      const query = input.query.toLowerCase();
      const results: ExactRecallResult[] = [];

      if (kinds.has("person")) {
        for (const person of people) {
          if (person.ownerUserId !== input.ownerUserId) continue;
          if (input.personId && person.id !== input.personId) continue;

          const fields = [
            ["displayName", person.displayName],
            ["firstName", person.firstName],
            ["lastName", person.lastName],
            ["profileBlurb", person.profileBlurb],
          ] as const;
          const matchedFields = fields
            .filter(([, value]) => value?.toLowerCase().includes(query))
            .map(([field]) => field);

          if (matchedFields.length === 0) continue;

          results.push({
            recordKind: "person",
            recordId: person.id,
            relatedPersonId: person.id,
            relatedPersonDisplayName: person.displayName,
            label: person.displayName,
            snippet: snippet(person.profileBlurb ?? person.displayName),
            matchedFields,
            rank: scoreMatch(matchedFields),
            trustLevel: "identity_reference",
            sensitivity: "normal",
          });
        }
      }

      return results.sort(compareResults).slice(0, input.limit);
    },
  };
}

function snippet(value: string) {
  return value.length > 160 ? `${value.slice(0, 157).trimEnd()}...` : value;
}

function scoreMatch(matchedFields: string[]) {
  let score = 0.1;
  if (matchedFields.includes("displayName")) score += 1;
  if (matchedFields.includes("profileBlurb")) score += 0.2;
  return score;
}

function compareResults(left: ExactRecallResult, right: ExactRecallResult) {
  return (
    right.rank - left.rank ||
    left.label.localeCompare(right.label) ||
    left.recordId.localeCompare(right.recordId)
  );
}
