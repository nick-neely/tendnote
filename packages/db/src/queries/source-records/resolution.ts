import type { SourceRecordPersonRole } from "@tendnote/domain";
import type { SourceRecordResolutionStore } from "./types";

export function createSourceRecordResolution(store: SourceRecordResolutionStore) {
  return {
    async findPersonResolutionCandidates(input: {
      ownerUserId: string;
      mentionText: string;
      limit?: number;
    }) {
      return store.findPeopleByDisplayName(input);
    },
    async linkSourceRecordToExistingPerson(input: {
      ownerUserId: string;
      sourceRecordId: string;
      personId: string;
      role?: SourceRecordPersonRole;
      unresolvedMentionId?: string;
    }) {
      const [sourceRecord, person] = await Promise.all([
        store.getSourceRecord(input),
        store.getPerson(input),
      ]);

      if (!sourceRecord) {
        throw new Error("Source record not found.");
      }

      if (!person) {
        throw new Error("Person not found.");
      }

      const role = input.role ?? "mentioned";
      const link = await store.linkSourceRecordPerson({
        sourceRecordId: sourceRecord.id,
        personId: person.id,
        role,
      });
      const updatedSourceRecord =
        sourceRecord.status === "active"
          ? sourceRecord
          : await store.updateSourceRecordStatus({
              ownerUserId: input.ownerUserId,
              sourceRecordId: sourceRecord.id,
              status: "active",
            });

      if (input.unresolvedMentionId) {
        await store.resolveUnresolvedMention({
          sourceRecordId: sourceRecord.id,
          unresolvedMentionId: input.unresolvedMentionId,
          personId: person.id,
        });
      }

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "source_record.resolve_person",
        entityType: "source_record",
        entityId: sourceRecord.id,
        metadataJson: {
          personId: person.id,
          role,
          unresolvedMentionId: input.unresolvedMentionId,
        },
      });

      return {
        sourceRecord: updatedSourceRecord,
        person,
        link,
      };
    },
    async createAndLinkPersonToSourceRecord(input: {
      ownerUserId: string;
      sourceRecordId: string;
      displayName: string;
      role?: SourceRecordPersonRole;
      unresolvedMentionId?: string;
    }) {
      const sourceRecord = await store.getSourceRecord(input);

      if (!sourceRecord) {
        throw new Error("Source record not found.");
      }

      const person = await store.createPerson({
        ownerUserId: input.ownerUserId,
        displayName: input.displayName.trim(),
        firstName: null,
        lastName: null,
        birthday: null,
        relationshipType: "other",
        closenessLevel: 3,
        profileBlurb: null,
        source: "manual",
      });
      const role = input.role ?? "mentioned";
      const link = await store.linkSourceRecordPerson({
        sourceRecordId: sourceRecord.id,
        personId: person.id,
        role,
      });
      const updatedSourceRecord =
        sourceRecord.status === "active"
          ? sourceRecord
          : await store.updateSourceRecordStatus({
              ownerUserId: input.ownerUserId,
              sourceRecordId: sourceRecord.id,
              status: "active",
            });

      if (input.unresolvedMentionId) {
        await store.resolveUnresolvedMention({
          sourceRecordId: sourceRecord.id,
          unresolvedMentionId: input.unresolvedMentionId,
          personId: person.id,
        });
      }

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "source_record.create_and_resolve_person",
        entityType: "source_record",
        entityId: sourceRecord.id,
        metadataJson: {
          personId: person.id,
          displayName: person.displayName,
          role,
          unresolvedMentionId: input.unresolvedMentionId,
        },
      });

      return {
        sourceRecord: updatedSourceRecord,
        person,
        link,
      };
    },
    async ignoreUnresolvedMention(input: {
      ownerUserId: string;
      sourceRecordId: string;
      unresolvedMentionId?: string;
    }) {
      const sourceRecord = await store.getSourceRecord(input);

      if (!sourceRecord) {
        throw new Error("Source record not found.");
      }

      if (!input.unresolvedMentionId) {
        throw new Error("Unresolved mention id is required.");
      }

      const unresolvedMention = await store.dismissUnresolvedMention({
        sourceRecordId: sourceRecord.id,
        unresolvedMentionId: input.unresolvedMentionId,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "source_record.ignore_unresolved_mention",
        entityType: "source_record",
        entityId: sourceRecord.id,
        metadataJson: {
          unresolvedMentionId: unresolvedMention.id,
          mentionText: unresolvedMention.mentionText,
        },
      });

      return unresolvedMention;
    },
    async listSourceRecordsForPersonContext(input: { ownerUserId: string; personId: string }) {
      const person = await store.getPerson(input);

      if (!person) {
        return [];
      }

      return store.listSourceRecordsForPersonContext(input);
    },
  };
}
