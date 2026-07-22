import type {
  ExactRecallResult,
  GeneralAction,
  HouseholdMembership,
  Memory,
  Person,
  SourceRecord,
  SourceRecordPerson,
} from "@tendnote/domain";
import {
  canRetrieveGeneralAction,
  decideGeneralActionEmbedding,
  generalActionRetrievalMeta,
  visibilityChoiceForScope,
  visibilityLabelForScope,
} from "@tendnote/domain";
import type { HouseholdRecordShare } from "../households/types";
import { canViewerSeeSeededHouseholdRecord } from "../households/visibility-memory";
import type { RelationshipContextSearchStore, SearchRelationshipContextQueryInput } from "./types";

/** The parsed, owner-scoped request the in-memory collectors operate on. */
type RelationshipContextSearchInput = SearchRelationshipContextQueryInput;

export type InMemoryRelationshipContextSearchSeed = {
  people?: Person[];
  memories?: Memory[];
  sourceRecords?: SourceRecord[];
  sourceRecordPeople?: SourceRecordPerson[];
  generalActions?: GeneralAction[];
  householdMemberships?: HouseholdMembership[];
  householdRecordShares?: HouseholdRecordShare[];
};

export function createInMemoryRelationshipContextSearchStore(
  seed: InMemoryRelationshipContextSearchSeed = {},
): RelationshipContextSearchStore {
  const people = seed.people ?? [];
  const memories = seed.memories ?? [];
  const sourceRecords = seed.sourceRecords ?? [];
  const sourceRecordPeople = seed.sourceRecordPeople ?? [];
  const generalActions = seed.generalActions ?? [];
  const householdMemberships = seed.householdMemberships ?? [];
  const householdRecordShares = seed.householdRecordShares ?? [];

  return {
    async searchRelationshipContext(input) {
      const kinds = new Set(
        input.recordKinds ?? ["person", "memory", "source_record", "general_action"],
      );
      const query = input.query.toLowerCase();
      const results: ExactRecallResult[] = [];

      if (kinds.has("person")) results.push(...collectPeopleMatches(input, query));
      if (kinds.has("memory")) results.push(...collectMemoryMatches(input, query));
      if (kinds.has("source_record")) results.push(...collectSourceRecordMatches(input, query));
      if (kinds.has("general_action")) results.push(...collectGeneralActionMatches(input, query));

      return results.sort(compareResults).slice(0, input.limit);
    },
  };

  /** Owner-scoped identity matches: a person whose name/blurb contains the query. */
  function collectPeopleMatches(
    input: RelationshipContextSearchInput,
    query: string,
  ): ExactRecallResult[] {
    return people
      .filter((person) => person.ownerUserId === input.ownerUserId)
      .filter((person) => !input.personId || person.id === input.personId)
      .map((person) => {
        const fields = [
          ["displayName", person.displayName],
          ["firstName", person.firstName],
          ["lastName", person.lastName],
          ["profileBlurb", person.profileBlurb],
        ] as const;
        const matchedFields = fields
          .filter(([, value]) => value?.toLowerCase().includes(query))
          .map(([field]) => field);
        return { person, matchedFields };
      })
      .filter(({ matchedFields }) => matchedFields.length > 0)
      .map(({ person, matchedFields }) => ({
        recordKind: "person",
        recordId: person.id,
        visibilityChoice: null,
        visibilityLabel: null,
        relatedPersonId: person.id,
        relatedPersonDisplayName: person.displayName,
        label: person.displayName,
        snippet: snippet(person.profileBlurb ?? person.displayName),
        matchedFields,
        rank: scoreMatch(matchedFields) + scoreRecency(person.updatedAt),
        trustLevel: "identity_reference",
        sensitivity: "normal",
      }));
  }

  /** Whether an approved, viewer-visible memory is a candidate for the query. */
  function isMemoryCandidate(memory: Memory, input: RelationshipContextSearchInput): boolean {
    if (!canViewerSeeRecord(input.ownerUserId, memory, "memory")) return false;
    if (memory.personId !== input.personId && input.personId) return false;
    if (memory.status !== "approved") return false;
    if (memory.sensitivity === "restricted" && !input.directlyRequested) return false;
    return true;
  }

  function collectMemoryMatches(
    input: RelationshipContextSearchInput,
    query: string,
  ): ExactRecallResult[] {
    return memories
      .filter((memory) => isMemoryCandidate(memory, input))
      .filter((memory) => matchesText(memory.content, query))
      .map((memory) => {
        const person = people.find(
          (candidate) =>
            candidate.id === memory.personId && candidate.ownerUserId === input.ownerUserId,
        );
        return {
          recordKind: "memory",
          recordId: memory.id,
          visibilityChoice: visibilityChoiceForScope(memory.scope),
          visibilityLabel: visibilityLabelForScope(memory.scope),
          relatedPersonId: person?.id ?? null,
          relatedPersonDisplayName: person?.displayName ?? null,
          label: person?.displayName ?? "Memory",
          snippet: snippet(memory.content),
          matchedFields: ["content"],
          rank:
            scoreText(memory.content, query) +
            memory.importance * 0.01 +
            scoreRecency(memory.updatedAt),
          trustLevel: "confirmed_fact",
          sensitivity: memory.sensitivity,
        };
      });
  }

  /** Whether an active, viewer-visible source record is a candidate for the query. */
  function isSourceRecordCandidate(
    sourceRecord: SourceRecord,
    input: RelationshipContextSearchInput,
    query: string,
  ): boolean {
    if (!canViewerSeeRecord(input.ownerUserId, sourceRecord, "source_record")) return false;
    if (sourceRecord.status !== "active") return false;
    if (sourceRecord.sensitivity === "restricted" && !input.directlyRequested) return false;
    return matchesText(sourceRecord.content, query);
  }

  function collectSourceRecordMatches(
    input: RelationshipContextSearchInput,
    query: string,
  ): ExactRecallResult[] {
    return sourceRecords
      .filter((sourceRecord) => isSourceRecordCandidate(sourceRecord, input, query))
      .map((sourceRecord) => {
        const relatedPeople = sourceRecordPeople
          .filter((link) => link.sourceRecordId === sourceRecord.id)
          .map((link) =>
            people.find(
              (candidate) =>
                candidate.id === link.personId && candidate.ownerUserId === input.ownerUserId,
            ),
          )
          .filter((candidate): candidate is Person => Boolean(candidate));
        const relatedPerson = input.personId
          ? relatedPeople.find((candidate) => candidate.id === input.personId)
          : relatedPeople[0];
        return { sourceRecord, relatedPerson };
      })
      .filter(({ relatedPerson }) => !input.personId || Boolean(relatedPerson))
      .map(({ sourceRecord, relatedPerson }) => ({
        recordKind: "source_record",
        recordId: sourceRecord.id,
        visibilityChoice: visibilityChoiceForScope(sourceRecord.scope),
        visibilityLabel: visibilityLabelForScope(sourceRecord.scope),
        relatedPersonId: relatedPerson?.id ?? null,
        relatedPersonDisplayName: relatedPerson?.displayName ?? null,
        label: relatedPerson?.displayName ?? "Logged note",
        snippet: snippet(sourceRecord.content),
        matchedFields: ["content"],
        rank:
          scoreText(sourceRecord.content, query) +
          sourceRecord.importance * 0.01 +
          scoreRecency(sourceRecord.updatedAt),
        trustLevel: "logged_context",
        sensitivity: sourceRecord.sensitivity,
      }));
  }

  /**
   * Whether a General Action may be retrieved for this query. General Actions are not
   * person context (ADRs 0143, 0155), so a person-scoped query never returns them; the
   * shared retrieval gate (ADRs 0151-0153) admits a durable action only to a caller who
   * may see it under scope rules, and a suggested proposal only in owner-only review.
   */
  function isGeneralActionCandidate(
    action: GeneralAction,
    input: RelationshipContextSearchInput,
  ): boolean {
    if (input.personId) return false;
    if (!input.includeArchived && decideGeneralActionEmbedding(action).action === "skip") {
      return false;
    }
    return canRetrieveGeneralAction({
      status: action.status,
      ownerUserId: action.ownerUserId,
      callerUserId: input.ownerUserId,
      scopeVisible: canViewerSeeRecord(input.ownerUserId, action, "general_action"),
      includeReviewGated: Boolean(input.includeReviewGated),
      includeArchived: input.includeArchived,
    });
  }

  function generalActionMatchedFields(action: GeneralAction, query: string): string[] {
    const matchedFields: string[] = [];
    if (matchesText(action.title, query)) matchedFields.push("title");
    if (action.notes && matchesText(action.notes, query)) matchedFields.push("notes");
    if (matchedFields.length === 0) matchedFields.push("title");
    return matchedFields;
  }

  function collectGeneralActionMatches(
    input: RelationshipContextSearchInput,
    query: string,
  ): ExactRecallResult[] {
    return generalActions
      .filter((action) => isGeneralActionCandidate(action, input))
      .map((action) => ({ action, haystack: `${action.title} ${action.notes ?? ""}` }))
      .filter(({ haystack }) => matchesText(haystack, query))
      .map(({ action, haystack }) => ({
        recordKind: "general_action",
        recordId: action.id,
        visibilityChoice: visibilityChoiceForScope(action.scope),
        visibilityLabel: visibilityLabelForScope(action.scope),
        relatedPersonId: null,
        relatedPersonDisplayName: null,
        label: action.title,
        snippet: snippet(haystack.trim()),
        matchedFields: generalActionMatchedFields(action, query),
        rank: scoreText(haystack, query) + scoreRecency(action.updatedAt),
        trustLevel: "action_item",
        sensitivity: "normal",
        generalAction: generalActionRetrievalMeta(action),
      }));
  }

  function canViewerSeeRecord(
    callerUserId: string,
    record: {
      id: string;
      ownerUserId: string;
      householdId?: string | null;
      scope: "private" | "shared" | "household";
    },
    recordKind: "memory" | "source_record" | "general_action",
  ) {
    return canViewerSeeSeededHouseholdRecord({
      callerUserId,
      record,
      recordKind,
      householdMemberships,
      householdRecordShares,
    });
  }
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

function scoreRecency(date: Date) {
  // Mirrors the drizzle adapter's `extract(epoch from updated_at)::float8 / 1e12`.
  // getTime() is milliseconds, so the divisor is 1e15 (= 1000 × 1e12): ms / 1e15 ≡
  // epoch-seconds / 1e12. Keep both in step — they are equal, not drifted.
  return date.getTime() / 1_000_000_000_000_000;
}

function compareResults(left: ExactRecallResult, right: ExactRecallResult) {
  return (
    right.rank - left.rank ||
    left.label.localeCompare(right.label) ||
    left.recordId.localeCompare(right.recordId)
  );
}
