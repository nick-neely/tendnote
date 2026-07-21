import type { Sensitivity, Source, SourceRecordPersonRole } from "@tendnote/domain";
import { createSourceRecordCapture } from "./capture";
import type { SourceRecordEmbeddingScheduler, SourceRecordResolutionStore } from "./types";

export function createSourceRecordResolution(
  store: SourceRecordResolutionStore,
  options: { scheduleSourceRecordEmbedding?: SourceRecordEmbeddingScheduler } = {},
) {
  const capture = createSourceRecordCapture(store);
  const resolution = {
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

      await options.scheduleSourceRecordEmbedding?.({
        ownerUserId: input.ownerUserId,
        recordKind: "source_record",
        recordId: updatedSourceRecord.id,
      });

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

      await options.scheduleSourceRecordEmbedding?.({
        ownerUserId: input.ownerUserId,
        recordKind: "source_record",
        recordId: updatedSourceRecord.id,
      });

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
    async unlinkSourceRecordFromPerson(input: {
      ownerUserId: string;
      sourceRecordId: string;
      personId: string;
    }) {
      const [sourceRecord, person] = await Promise.all([
        store.getSourceRecord(input),
        store.getPerson(input),
      ]);
      if (!sourceRecord || !person) throw new Error("Captured Person link not found.");
      await store.unlinkSourceRecordPerson(input);
      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "source_record.unlink_person",
        entityType: "source_record",
        entityId: input.sourceRecordId,
        metadataJson: { personId: input.personId },
      });
      return { sourceRecord, person };
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
    /**
     * Context-aware capture: save a casual note and link it to a person the
     * caller already resolved, in one shared owner-scoped operation. Used when
     * the assistant is launched from a person surface so capture does not need a
     * separate disambiguation step (ADR 0032). Extraction is enqueued by the
     * caller after this returns (ADR 0017).
     */
    async captureSourceRecordForPerson(input: {
      ownerUserId: string;
      personId: string;
      retainedContent: string;
      sourceType?: Source;
      sensitivity?: Sensitivity;
      role?: SourceRecordPersonRole;
      metadataJson?: Record<string, unknown>;
    }) {
      const { sourceRecord, component } = await capture.captureSourceRecord({
        ownerUserId: input.ownerUserId,
        retainedContent: input.retainedContent,
        sourceType: input.sourceType,
        sensitivity: input.sensitivity,
        metadataJson: input.metadataJson,
      });
      const linked = await resolution.linkSourceRecordToExistingPerson({
        ownerUserId: input.ownerUserId,
        sourceRecordId: sourceRecord.id,
        personId: input.personId,
        role: input.role ?? "primary",
      });

      return {
        sourceRecord: linked.sourceRecord,
        component,
        person: linked.person,
        link: linked.link,
      };
    },
  };

  return resolution;
}
