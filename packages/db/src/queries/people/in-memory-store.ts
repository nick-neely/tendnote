import { randomUUID } from "node:crypto";
import type { Followup, Memory, Person, SourceRecord, SourceRecordPerson } from "@tendnote/domain";
import type { PeopleStore, PersonAuditLogEntry } from "./types";

export type InMemoryPeopleStoreSeed = {
  people?: Person[];
  memories?: Memory[];
  followups?: Followup[];
  sourceRecords?: SourceRecord[];
  sourceRecordPeople?: SourceRecordPerson[];
};

export type InMemoryPeopleStore = PeopleStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<PersonAuditLogEntry[]>;
};

export function createInMemoryPeopleStore(seed: InMemoryPeopleStoreSeed = {}): InMemoryPeopleStore {
  const people = new Map((seed.people ?? []).map((person) => [person.id, person]));
  const memories = new Map((seed.memories ?? []).map((memory) => [memory.id, memory]));
  const followups = new Map((seed.followups ?? []).map((followup) => [followup.id, followup]));
  const sourceRecords = new Map(
    (seed.sourceRecords ?? []).map((sourceRecord) => [sourceRecord.id, sourceRecord]),
  );
  const sourceRecordPeople = new Map(
    (seed.sourceRecordPeople ?? []).map((link) => [
      `${link.sourceRecordId}:${link.personId}`,
      link,
    ]),
  );
  const auditLogEntries: PersonAuditLogEntry[] = [];

  return {
    async createPerson(values) {
      const now = new Date();
      const person = {
        ...values,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      people.set(person.id, person);

      return person;
    },

    async createAuditLogEntry(values) {
      auditLogEntries.push(values);
    },

    async searchPeople(input) {
      return [...people.values()]
        .filter((person) => {
          const matchesOwner = person.ownerUserId === input.ownerUserId;
          const matchesQuery =
            !input.query || person.displayName.toLowerCase().includes(input.query.toLowerCase());
          const matchesRelationship =
            !input.relationshipType || person.relationshipType === input.relationshipType;

          return matchesOwner && matchesQuery && matchesRelationship;
        })
        .slice(0, input.limit);
    },

    async getPersonProfile(input) {
      const person = people.get(input.personId);

      if (!person || person.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return {
        person,
        memories: [...memories.values()].filter(
          (memory) =>
            memory.personId === input.personId && memory.ownerUserId === input.ownerUserId,
        ),
        followups: [...followups.values()].filter(
          (followup) =>
            followup.personId === input.personId && followup.ownerUserId === input.ownerUserId,
        ),
        sourceRecords: [...sourceRecords.values()].filter(
          (sourceRecord) =>
            sourceRecord.ownerUserId === input.ownerUserId &&
            [...sourceRecordPeople.values()].some(
              (link) => link.personId === input.personId && link.sourceRecordId === sourceRecord.id,
            ),
        ),
      };
    },

    async listAuditLogEntries(input) {
      return auditLogEntries.filter((entry) => entry.ownerUserId === input.ownerUserId);
    },
  };
}
