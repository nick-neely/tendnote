import { randomUUID } from "node:crypto";
import {
  comparePeopleForSearch,
  type Followup,
  type HouseholdMembership,
  type Memory,
  type Person,
  personMatchesPeopleSearch,
  type SourceRecord,
  type SourceRecordPerson,
} from "@tendnote/domain";
import type { HouseholdRecordShare } from "../households/types";
import { canViewerSeeSeededHouseholdRecord } from "../households/visibility-memory";
import type { PeopleStore, PersonAuditLogEntry } from "./types";

export type InMemoryPeopleStoreSeed = {
  people?: Person[];
  memories?: Memory[];
  followups?: Followup[];
  sourceRecords?: SourceRecord[];
  sourceRecordPeople?: SourceRecordPerson[];
  householdMemberships?: HouseholdMembership[];
  householdRecordShares?: HouseholdRecordShare[];
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
  const householdMemberships = seed.householdMemberships ?? [];
  const householdRecordShares = seed.householdRecordShares ?? [];

  function visibleFollowupsFor(input: { callerUserId: string; personId: string }) {
    return [...followups.values()].filter(
      (followup) =>
        followup.personId === input.personId &&
        canViewerSeeSeededHouseholdRecord({
          callerUserId: input.callerUserId,
          record: followup,
          recordKind: "followup",
          householdMemberships,
          householdRecordShares,
        }),
    );
  }

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

    async updatePerson({ ownerUserId, personId, patch }) {
      const existing = people.get(personId);

      if (!existing || existing.ownerUserId !== ownerUserId) {
        return null;
      }

      const updated = { ...existing, ...patch, updatedAt: new Date() };
      people.set(personId, updated);

      return updated;
    },

    async deletePerson({ ownerUserId, personId }) {
      const existing = people.get(personId);

      if (!existing || existing.ownerUserId !== ownerUserId) {
        return null;
      }

      // The production adapter leans on database cascades to remove owned rows;
      // mirror that here so the double stays faithful — drop the person and any
      // memories, follow-ups, source records, and links that belonged to them.
      people.delete(personId);
      for (const [id, memory] of memories) {
        if (memory.personId === personId) {
          memories.delete(id);
        }
      }
      for (const [id, followup] of followups) {
        if (followup.personId === personId) {
          followups.delete(id);
        }
      }
      for (const [key, link] of sourceRecordPeople) {
        if (link.personId === personId) {
          sourceRecordPeople.delete(key);
        }
      }

      return existing;
    },

    async createAuditLogEntry(values) {
      auditLogEntries.push(values);
    },

    async searchPeople(input) {
      return [...people.values()]
        .filter(
          (person) =>
            person.ownerUserId === input.ownerUserId &&
            personMatchesPeopleSearch(person, {
              query: input.query,
              relationshipType: input.relationshipType,
            }),
        )
        .sort(comparePeopleForSearch)
        .slice(0, input.limit);
    },

    async getPerson(input) {
      const person = people.get(input.personId);
      return person?.ownerUserId === input.ownerUserId ? person : null;
    },

    async getPersonDetailCore(input) {
      const person = people.get(input.personId);

      if (!person) return null;

      if (person.ownerUserId !== input.ownerUserId) {
        const visibleFollowups = visibleFollowupsFor({
          callerUserId: input.ownerUserId,
          personId: input.personId,
        });
        if (!visibleFollowups.length) return null;

        return {
          person,
          counts: { memories: 0, followups: visibleFollowups.length, sourceRecords: 0 },
        };
      }

      return {
        person,
        counts: {
          memories: [...memories.values()].filter(
            (memory) =>
              memory.personId === input.personId && memory.ownerUserId === input.ownerUserId,
          ).length,
          followups: [...followups.values()].filter(
            (followup) =>
              followup.personId === input.personId && followup.ownerUserId === input.ownerUserId,
          ).length,
          sourceRecords: [...sourceRecords.values()].filter(
            (sourceRecord) =>
              sourceRecord.ownerUserId === input.ownerUserId &&
              [...sourceRecordPeople.values()].some(
                (link) =>
                  link.personId === input.personId && link.sourceRecordId === sourceRecord.id,
              ),
          ).length,
        },
      };
    },

    async getPersonProfile(input) {
      const person = people.get(input.personId);

      if (!person) return null;

      if (person.ownerUserId !== input.ownerUserId) {
        const visibleFollowups = visibleFollowupsFor({
          callerUserId: input.ownerUserId,
          personId: input.personId,
        });
        if (!visibleFollowups.length) return null;
        return { person, memories: [], followups: visibleFollowups, sourceRecords: [] };
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
