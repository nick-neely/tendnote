import { randomUUID } from "node:crypto";
import {
  canUseMemoryProactively,
  comparePeopleForSearch,
  type Followup,
  type HouseholdMembership,
  isActiveFollowupStatus,
  type Memory,
  type MessageDraft,
  type Person,
  type PersonUpdateSummary,
  personMatchesPeopleSearch,
  type SourceRecord,
  type SourceRecordPerson,
} from "@tendnote/domain";
import type { HouseholdRecordShare } from "../households/types";
import { canViewerSeeSeededHouseholdRecord } from "../households/visibility-memory";
import type { PeopleStore, PersonAuditLogEntry } from "./types";
import {
  nextPersonRevision,
  personUpdateChanges,
  personUpdateStatus,
  previousPersonValues,
} from "./update-contract";

export type InMemoryPeopleStoreSeed = {
  people?: Person[];
  memories?: Memory[];
  followups?: Followup[];
  messageDrafts?: MessageDraft[];
  sourceRecords?: SourceRecord[];
  sourceRecordPeople?: SourceRecordPerson[];
  householdMemberships?: HouseholdMembership[];
  householdRecordShares?: HouseholdRecordShare[];
};

/**
 * The follow-ups the person page asks the owner to do something about: active
 * reminders plus tentative proposals. Mirrors `FOLLOWUP_TAB_STATUSES` in the
 * Drizzle adapter.
 */
function needsFollowupAttention(followup: Followup): boolean {
  return isActiveFollowupStatus(followup.status) || followup.status === "suggested";
}

export type InMemoryPeopleStore = PeopleStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<PersonAuditLogEntry[]>;
};

export function createInMemoryPeopleStore(seed: InMemoryPeopleStoreSeed = {}): InMemoryPeopleStore {
  const people = new Map((seed.people ?? []).map((person) => [person.id, person]));
  const updates = new Map<string, PersonUpdateSummary & { revision: number; undone: boolean }>();
  const memories = new Map((seed.memories ?? []).map((memory) => [memory.id, memory]));
  const followups = new Map((seed.followups ?? []).map((followup) => [followup.id, followup]));
  const messageDrafts = new Map((seed.messageDrafts ?? []).map((draft) => [draft.id, draft]));
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

      const changes = personUpdateChanges(existing, patch);
      if (!changes.length) return { ...existing, update: null };
      const updated = { ...existing, ...patch, updatedAt: nextPersonRevision(existing.updatedAt) };
      people.set(personId, updated);
      const update = { target: { personId, updateId: randomUUID() }, changes };
      updates.set(personId, { ...update, revision: updated.updatedAt.getTime(), undone: false });
      return { ...updated, update };
    },

    async getLatestPersonUpdate({ ownerUserId, personId }) {
      const person = people.get(personId);
      const update = updates.get(personId);
      if (
        !person ||
        person.ownerUserId !== ownerUserId ||
        !update ||
        update.undone ||
        update.revision !== person.updatedAt.getTime()
      )
        return null;
      return { target: update.target, changes: update.changes };
    },

    async getPersonUpdateStatus({ ownerUserId, personId, updateId }) {
      const person = people.get(personId);
      const update = updates.get(personId);
      return {
        status: personUpdateStatus({
          updateId,
          currentRevision:
            person?.ownerUserId === ownerUserId ? person.updatedAt.getTime() : undefined,
          receipt: update
            ? { updateId: update.target.updateId, revision: update.revision, undone: update.undone }
            : undefined,
        }),
      };
    },
    async undoPersonUpdate({ ownerUserId, personId, updateId }) {
      const person = people.get(personId);
      if (!person || person.ownerUserId !== ownerUserId) return { status: "unavailable" };
      const update = updates.get(personId);
      const status = personUpdateStatus({
        updateId,
        currentRevision: person.updatedAt.getTime(),
        receipt: update
          ? { updateId: update.target.updateId, revision: update.revision, undone: update.undone }
          : undefined,
      });
      if (status !== "available" || !update)
        return { status: status === "available" ? "superseded" : status };
      people.set(personId, {
        ...person,
        ...previousPersonValues(update.changes),
        updatedAt: nextPersonRevision(person.updatedAt),
      });
      update.undone = true;
      update.changes = [];
      return { status: "applied" };
    },

    async deletePerson({ ownerUserId, personId }) {
      const existing = people.get(personId);

      if (!existing || existing.ownerUserId !== ownerUserId) {
        return null;
      }

      // The production adapter leans on database cascades to remove owned rows;
      // mirror that here so the double stays faithful — drop the person and any
      // memories, follow-ups, drafts, source records, and links that belonged to them.
      people.delete(personId);
      updates.delete(personId);
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
      for (const [id, draft] of messageDrafts) {
        if (draft.personId === personId) {
          messageDrafts.delete(id);
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

        // Visibility is decided by any shared follow-up; the count is only what
        // the viewer's Follow-ups tab would actually list.
        return {
          person,
          counts: {
            memories: 0,
            review: 0,
            followups: visibleFollowups.filter(needsFollowupAttention).length,
            drafts: 0,
          },
        };
      }

      const ownedMemories = [...memories.values()].filter(
        (memory) => memory.personId === input.personId && memory.ownerUserId === input.ownerUserId,
      );

      return {
        person,
        counts: {
          memories: ownedMemories.filter((memory) => canUseMemoryProactively(memory)).length,
          review: ownedMemories.filter((memory) => memory.status === "suggested").length,
          followups: [...followups.values()].filter(
            (followup) =>
              followup.personId === input.personId &&
              followup.ownerUserId === input.ownerUserId &&
              needsFollowupAttention(followup),
          ).length,
          drafts: [...messageDrafts.values()].filter(
            (draft) =>
              draft.personId === input.personId &&
              draft.ownerUserId === input.ownerUserId &&
              (draft.status === "draft" || draft.status === "approved"),
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
