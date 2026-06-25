import { randomUUID } from "node:crypto";
import type {
  Person,
  SourceRecord,
  SourceRecordPerson,
  UnresolvedPersonMention,
} from "@tendnote/domain";
import type { InMemorySourceRecordStore, SourceRecordAuditLogEntry } from "./types";

export function createInMemorySourceRecordStore(): InMemorySourceRecordStore {
  const sourceRecords = new Map<string, SourceRecord>();
  const people = new Map<string, Person>();
  const unresolvedMentions = new Map<string, UnresolvedPersonMention>();
  const sourceRecordPeople = new Map<string, SourceRecordPerson>();
  const auditLogEntries: SourceRecordAuditLogEntry[] = [];

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
    async getPerson(input) {
      const person = people.get(input.personId);

      if (!person || person.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return person;
    },
    async listPeople(input) {
      return [...people.values()].filter((person) => person.ownerUserId === input.ownerUserId);
    },
    async findPeopleByDisplayName(input) {
      const mentionText = input.mentionText.toLowerCase();

      return [...people.values()]
        .filter(
          (person) =>
            person.ownerUserId === input.ownerUserId &&
            person.displayName.toLowerCase().includes(mentionText),
        )
        .slice(0, input.limit ?? 10);
    },
    async createSourceRecord(values) {
      const now = new Date();

      const sourceRecord = {
        ...values,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      sourceRecords.set(sourceRecord.id, sourceRecord);

      return sourceRecord;
    },
    async updateSourceRecordStatus(input) {
      const sourceRecord = sourceRecords.get(input.sourceRecordId);

      if (!sourceRecord || sourceRecord.ownerUserId !== input.ownerUserId) {
        throw new Error("Source record not found.");
      }

      const updatedSourceRecord = {
        ...sourceRecord,
        status: input.status,
        updatedAt: new Date(),
      };

      sourceRecords.set(updatedSourceRecord.id, updatedSourceRecord);

      return updatedSourceRecord;
    },
    async createUnresolvedMention(values) {
      const now = new Date();
      const unresolvedMention = {
        ...values,
        id: randomUUID(),
        candidatePersonIds: values.candidatePersonIds ?? [],
        status: values.status ?? "unresolved",
        resolvedPersonId: values.resolvedPersonId ?? null,
        createdAt: now,
        resolvedAt: values.resolvedAt ?? null,
      };

      unresolvedMentions.set(unresolvedMention.id, unresolvedMention);

      return unresolvedMention;
    },
    async listUnresolvedMentions(input) {
      return [...unresolvedMentions.values()].filter(
        (mention) => mention.sourceRecordId === input.sourceRecordId,
      );
    },
    async listSourceRecordPeople(input) {
      return [...sourceRecordPeople.values()].filter(
        (link) => link.sourceRecordId === input.sourceRecordId,
      );
    },
    async listSourceRecordsForPersonContext(input) {
      const person = people.get(input.personId);

      if (!person || person.ownerUserId !== input.ownerUserId) {
        return [];
      }

      const linkedSourceRecordIds = new Set(
        [...sourceRecordPeople.values()]
          .filter((link) => link.personId === input.personId)
          .map((link) => link.sourceRecordId),
      );

      return [...sourceRecords.values()].filter(
        (sourceRecord) =>
          sourceRecord.ownerUserId === input.ownerUserId &&
          sourceRecord.status === "active" &&
          linkedSourceRecordIds.has(sourceRecord.id),
      );
    },
    async linkSourceRecordPerson(input) {
      const key = `${input.sourceRecordId}:${input.personId}`;
      const existingLink = sourceRecordPeople.get(key);

      if (existingLink) {
        const updatedLink = {
          ...existingLink,
          role: input.role,
        };

        sourceRecordPeople.set(key, updatedLink);

        return updatedLink;
      }

      const link = {
        ...input,
        id: randomUUID(),
        createdAt: new Date(),
      };

      sourceRecordPeople.set(key, link);

      return link;
    },
    async resolveUnresolvedMention(input) {
      const unresolvedMention = unresolvedMentions.get(input.unresolvedMentionId);

      if (!unresolvedMention || unresolvedMention.sourceRecordId !== input.sourceRecordId) {
        throw new Error("Unresolved mention not found.");
      }

      const resolvedMention = {
        ...unresolvedMention,
        status: "resolved" as const,
        resolvedPersonId: input.personId,
        resolvedAt: new Date(),
      };

      unresolvedMentions.set(resolvedMention.id, resolvedMention);

      return resolvedMention;
    },
    async dismissUnresolvedMention(input) {
      const unresolvedMention = unresolvedMentions.get(input.unresolvedMentionId);

      if (!unresolvedMention || unresolvedMention.sourceRecordId !== input.sourceRecordId) {
        throw new Error("Unresolved mention not found.");
      }

      const dismissedMention = {
        ...unresolvedMention,
        status: "dismissed" as const,
      };

      unresolvedMentions.set(dismissedMention.id, dismissedMention);

      return dismissedMention;
    },
    async createAuditLogEntry(values) {
      const auditLogEntry = {
        ...values,
        id: randomUUID(),
        createdAt: new Date(),
      };

      auditLogEntries.push(auditLogEntry);

      return auditLogEntry;
    },
    async getSourceRecord(input) {
      const sourceRecord = sourceRecords.get(input.sourceRecordId);

      if (!sourceRecord || sourceRecord.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return sourceRecord;
    },
    async getSourceRecordById(sourceRecordId) {
      return sourceRecords.get(sourceRecordId) ?? null;
    },
    async listAuditLogEntries(input) {
      return auditLogEntries.filter((entry) => entry.ownerUserId === input.ownerUserId);
    },
  };
}
