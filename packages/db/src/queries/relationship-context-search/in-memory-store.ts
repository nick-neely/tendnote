import type { ExactRecallResult, Memory, Person } from "@tendnote/domain";
import type { RelationshipContextSearchStore } from "./types";

export type InMemoryRelationshipContextSearchSeed = {
  people?: Person[];
  memories?: Memory[];
};

export function createInMemoryRelationshipContextSearchStore(
  seed: InMemoryRelationshipContextSearchSeed = {},
): RelationshipContextSearchStore {
  const people = seed.people ?? [];
  const memories = seed.memories ?? [];

  return {
    async searchRelationshipContext(input) {
      const kinds = new Set(input.recordKinds ?? ["person", "memory"]);
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

      if (kinds.has("memory")) {
        for (const memory of memories) {
          if (memory.ownerUserId !== input.ownerUserId) continue;
          if (memory.personId !== input.personId && input.personId) continue;
          if (memory.status !== "approved") continue;
          if (memory.sensitivity === "restricted" && !input.directlyRequested) continue;
          if (!matchesText(memory.content, query)) continue;

          const person = people.find(
            (candidate) =>
              candidate.id === memory.personId && candidate.ownerUserId === input.ownerUserId,
          );

          results.push({
            recordKind: "memory",
            recordId: memory.id,
            relatedPersonId: memory.personId,
            relatedPersonDisplayName: person?.displayName ?? null,
            label: person?.displayName ?? "Memory",
            snippet: snippet(memory.content),
            matchedFields: ["content"],
            rank: scoreText(memory.content, query) + memory.importance * 0.01,
            trustLevel: "confirmed_fact",
            sensitivity: memory.sensitivity,
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

function scoreText(value: string, query: string) {
  const lower = value.toLowerCase();
  const terms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const matchedTerms = terms.filter((term) => lower.includes(term)).length;
  const phraseBoost = lower.includes(query) ? 1 : 0;

  return 0.6 + phraseBoost + matchedTerms * 0.2;
}

function matchesText(value: string, query: string) {
  const lower = value.toLowerCase();
  return query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .every((term) => lower.includes(term));
}

function compareResults(left: ExactRecallResult, right: ExactRecallResult) {
  return (
    right.rank - left.rank ||
    left.label.localeCompare(right.label) ||
    left.recordId.localeCompare(right.recordId)
  );
}
