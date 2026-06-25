import { randomUUID } from "node:crypto";
import {
  type Confidence,
  createSourceRecordSchema,
  type Person,
  type Sensitivity,
  type Source,
  type SourceRecord,
  type SourceRecordPerson,
  type SourceRecordPersonRole,
  type SourceRecordStatus,
  type UnresolvedPersonMention,
} from "@tendnote/domain";
import { and, desc, eq, ilike } from "drizzle-orm";
import { getDb } from "../client";
import {
  auditLog,
  people,
  sourceRecordPeople,
  sourceRecords,
  unresolvedPersonMentions,
} from "../schema";

export type SourceRecordReviewComponent = {
  type: "source_record_review";
  sourceRecordId: string;
};

export type CaptureSourceRecordInput = {
  ownerUserId: string;
  retainedContent: string;
  sourceType?: Source;
  status?: SourceRecordStatus;
  confidence?: Confidence;
  sensitivity?: Sensitivity;
  metadataJson?: Record<string, unknown>;
  unresolvedMentions?: Array<{
    mentionText: string;
    candidatePersonIds?: string[];
  }>;
};

export type CaptureSourceRecordResult = {
  sourceRecord: SourceRecord;
  component: SourceRecordReviewComponent;
};

export type GetSourceRecordReviewInput = {
  ownerUserId: string;
  sourceRecordId: string;
};

export type ListSourceRecordReviewsInput = {
  ownerUserId: string;
  limit?: number;
};

export type SourceRecordReviewResult = {
  sourceRecord: SourceRecord;
  component: SourceRecordReviewComponent;
};

export type SourceRecordAuditLogEntry = {
  id: string;
  ownerUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
};

export type CreateResolutionPersonInput = Omit<Person, "id" | "createdAt" | "updatedAt">;

export type CreateUnresolvedMentionInput = Omit<
  UnresolvedPersonMention,
  "id" | "createdAt" | "resolvedAt" | "status" | "resolvedPersonId"
> &
  Partial<Pick<UnresolvedPersonMention, "status" | "resolvedPersonId" | "resolvedAt">>;

export type SourceRecordCaptureStore = {
  createSourceRecord: (
    sourceRecord: Omit<SourceRecord, "id" | "createdAt" | "updatedAt">,
  ) => Promise<SourceRecord>;
  getSourceRecord: (input: GetSourceRecordReviewInput) => Promise<SourceRecord | null>;
  updateSourceRecordStatus: (input: {
    ownerUserId: string;
    sourceRecordId: string;
    status: SourceRecordStatus;
  }) => Promise<SourceRecord>;
  createUnresolvedMention: (
    unresolvedMention: CreateUnresolvedMentionInput,
  ) => Promise<UnresolvedPersonMention>;
  createAuditLogEntry: (
    auditLogEntry: Omit<SourceRecordAuditLogEntry, "id" | "createdAt">,
  ) => Promise<SourceRecordAuditLogEntry>;
};

export type InMemorySourceRecordStore = SourceRecordCaptureStore & {
  createPerson: (person: CreateResolutionPersonInput) => Promise<Person>;
  getPerson: (input: { ownerUserId: string; personId: string }) => Promise<Person | null>;
  listPeople: (input: { ownerUserId: string }) => Promise<Person[]>;
  findPeopleByDisplayName: (input: {
    ownerUserId: string;
    mentionText: string;
    limit?: number;
  }) => Promise<Person[]>;
  listUnresolvedMentions: (input: { sourceRecordId: string }) => Promise<UnresolvedPersonMention[]>;
  listSourceRecordPeople: (input: { sourceRecordId: string }) => Promise<SourceRecordPerson[]>;
  listSourceRecordsForPersonContext: (input: {
    ownerUserId: string;
    personId: string;
  }) => Promise<SourceRecord[]>;
  linkSourceRecordPerson: (input: {
    sourceRecordId: string;
    personId: string;
    role: SourceRecordPersonRole;
  }) => Promise<SourceRecordPerson>;
  resolveUnresolvedMention: (input: {
    sourceRecordId: string;
    unresolvedMentionId: string;
    personId: string;
  }) => Promise<UnresolvedPersonMention>;
  dismissUnresolvedMention: (input: {
    sourceRecordId: string;
    unresolvedMentionId: string;
  }) => Promise<UnresolvedPersonMention>;
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<SourceRecordAuditLogEntry[]>;
};

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
    async listAuditLogEntries(input) {
      return auditLogEntries.filter((entry) => entry.ownerUserId === input.ownerUserId);
    },
  };
}

export function createSourceRecordCapture(store: SourceRecordCaptureStore) {
  return {
    async captureSourceRecord(input: CaptureSourceRecordInput): Promise<CaptureSourceRecordResult> {
      const sourceRecordValues = createSourceRecordSchema.parse({
        ownerUserId: input.ownerUserId,
        sourceType: input.sourceType ?? "manual",
        content: input.retainedContent,
        rawContent: null,
        retentionPolicy: "retain",
        status:
          input.status ?? (input.unresolvedMentions?.length ? "pending_resolution" : "active"),
        confidence: input.confidence ?? "medium",
        sensitivity: input.sensitivity ?? "normal",
        scope: "private",
        importance: 3,
        metadataJson: input.metadataJson ?? {},
      });

      const sourceRecord = await store.createSourceRecord(sourceRecordValues);
      for (const mention of input.unresolvedMentions ?? []) {
        await store.createUnresolvedMention({
          sourceRecordId: sourceRecord.id,
          mentionText: mention.mentionText,
          candidatePersonIds: mention.candidatePersonIds ?? [],
        });
      }
      await store.createAuditLogEntry({
        ownerUserId: sourceRecord.ownerUserId,
        action: "source_record.capture",
        entityType: "source_record",
        entityId: sourceRecord.id,
        metadataJson: {
          sourceType: sourceRecord.sourceType,
          componentType: "source_record_review",
        },
      });

      return {
        sourceRecord,
        component: {
          type: "source_record_review",
          sourceRecordId: sourceRecord.id,
        },
      };
    },
    async getSourceRecordReview(
      input: GetSourceRecordReviewInput,
    ): Promise<SourceRecordReviewResult | null> {
      const sourceRecord = await store.getSourceRecord(input);

      if (!sourceRecord) {
        return null;
      }

      return {
        sourceRecord,
        component: {
          type: "source_record_review",
          sourceRecordId: sourceRecord.id,
        },
      };
    },
  };
}

export type SourceRecordResolutionStore = SourceRecordCaptureStore & {
  createPerson: (person: CreateResolutionPersonInput) => Promise<Person>;
  getPerson: (input: { ownerUserId: string; personId: string }) => Promise<Person | null>;
  findPeopleByDisplayName: (input: {
    ownerUserId: string;
    mentionText: string;
    limit?: number;
  }) => Promise<Person[]>;
  linkSourceRecordPerson: (input: {
    sourceRecordId: string;
    personId: string;
    role: SourceRecordPersonRole;
  }) => Promise<SourceRecordPerson>;
  listSourceRecordsForPersonContext: (input: {
    ownerUserId: string;
    personId: string;
  }) => Promise<SourceRecord[]>;
  resolveUnresolvedMention: (input: {
    sourceRecordId: string;
    unresolvedMentionId: string;
    personId: string;
  }) => Promise<UnresolvedPersonMention>;
  dismissUnresolvedMention: (input: {
    sourceRecordId: string;
    unresolvedMentionId: string;
  }) => Promise<UnresolvedPersonMention>;
};

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

function createDrizzleSourceRecordStore(): SourceRecordResolutionStore {
  return {
    async createPerson(values) {
      const [person] = await getDb().insert(people).values(values).returning();

      if (!person) {
        throw new Error("Failed to create person.");
      }

      return person;
    },
    async getPerson(input) {
      const [person] = await getDb()
        .select()
        .from(people)
        .where(and(eq(people.id, input.personId), eq(people.ownerUserId, input.ownerUserId)))
        .limit(1);

      return person ?? null;
    },
    async findPeopleByDisplayName(input) {
      return getDb()
        .select()
        .from(people)
        .where(
          and(
            eq(people.ownerUserId, input.ownerUserId),
            ilike(people.displayName, `%${input.mentionText}%`),
          ),
        )
        .limit(input.limit ?? 10);
    },
    async createSourceRecord(values) {
      const [sourceRecord] = await getDb().insert(sourceRecords).values(values).returning();

      if (!sourceRecord) {
        throw new Error("Failed to capture source record.");
      }

      return sourceRecord;
    },
    async updateSourceRecordStatus(input) {
      const [sourceRecord] = await getDb()
        .update(sourceRecords)
        .set({
          status: input.status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sourceRecords.id, input.sourceRecordId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();

      if (!sourceRecord) {
        throw new Error("Source record not found.");
      }

      return sourceRecord;
    },
    async createUnresolvedMention(values) {
      const [unresolvedMention] = await getDb()
        .insert(unresolvedPersonMentions)
        .values(values)
        .returning();

      if (!unresolvedMention) {
        throw new Error("Failed to create unresolved person mention.");
      }

      return unresolvedMention;
    },
    async linkSourceRecordPerson(values) {
      const [link] = await getDb()
        .insert(sourceRecordPeople)
        .values(values)
        .onConflictDoUpdate({
          target: [sourceRecordPeople.sourceRecordId, sourceRecordPeople.personId],
          set: {
            role: values.role,
          },
        })
        .returning();

      if (!link) {
        throw new Error("Failed to link source record to person.");
      }

      return link;
    },
    async resolveUnresolvedMention(input) {
      const [unresolvedMention] = await getDb()
        .update(unresolvedPersonMentions)
        .set({
          status: "resolved",
          resolvedPersonId: input.personId,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(unresolvedPersonMentions.id, input.unresolvedMentionId),
            eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId),
          ),
        )
        .returning();

      if (!unresolvedMention) {
        throw new Error("Unresolved mention not found.");
      }

      return unresolvedMention;
    },
    async dismissUnresolvedMention(input) {
      const [unresolvedMention] = await getDb()
        .update(unresolvedPersonMentions)
        .set({
          status: "dismissed",
        })
        .where(
          and(
            eq(unresolvedPersonMentions.id, input.unresolvedMentionId),
            eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId),
          ),
        )
        .returning();

      if (!unresolvedMention) {
        throw new Error("Unresolved mention not found.");
      }

      return unresolvedMention;
    },
    async listSourceRecordsForPersonContext(input) {
      const rows = await getDb()
        .select({ sourceRecord: sourceRecords })
        .from(sourceRecordPeople)
        .innerJoin(sourceRecords, eq(sourceRecordPeople.sourceRecordId, sourceRecords.id))
        .where(
          and(
            eq(sourceRecordPeople.personId, input.personId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
            eq(sourceRecords.status, "active"),
          ),
        )
        .orderBy(desc(sourceRecords.createdAt));

      return rows.map((row) => row.sourceRecord);
    },
    async createAuditLogEntry(values) {
      const [auditLogEntry] = await getDb().insert(auditLog).values(values).returning();

      if (!auditLogEntry) {
        throw new Error("Failed to write source record audit log.");
      }

      return {
        ...auditLogEntry,
        ownerUserId: auditLogEntry.ownerUserId ?? values.ownerUserId,
      };
    },
    async getSourceRecord(input) {
      const [sourceRecord] = await getDb()
        .select()
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.id, input.sourceRecordId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);

      return sourceRecord ?? null;
    },
  };
}

const defaultSourceRecordCapture = createSourceRecordCapture(createDrizzleSourceRecordStore());

export async function captureSourceRecord(input: CaptureSourceRecordInput) {
  return defaultSourceRecordCapture.captureSourceRecord(input);
}

export async function getSourceRecordReview(input: GetSourceRecordReviewInput) {
  return defaultSourceRecordCapture.getSourceRecordReview(input);
}

const defaultSourceRecordResolution = createSourceRecordResolution(
  createDrizzleSourceRecordStore(),
);

export async function findPersonResolutionCandidates(input: {
  ownerUserId: string;
  mentionText: string;
  limit?: number;
}) {
  return defaultSourceRecordResolution.findPersonResolutionCandidates(input);
}

export async function linkSourceRecordToExistingPerson(input: {
  ownerUserId: string;
  sourceRecordId: string;
  personId: string;
  role?: SourceRecordPersonRole;
  unresolvedMentionId?: string;
}) {
  return defaultSourceRecordResolution.linkSourceRecordToExistingPerson(input);
}

export async function createAndLinkPersonToSourceRecord(input: {
  ownerUserId: string;
  sourceRecordId: string;
  displayName: string;
  role?: SourceRecordPersonRole;
  unresolvedMentionId?: string;
}) {
  return defaultSourceRecordResolution.createAndLinkPersonToSourceRecord(input);
}

export async function ignoreUnresolvedMention(input: {
  ownerUserId: string;
  sourceRecordId: string;
  unresolvedMentionId?: string;
}) {
  return defaultSourceRecordResolution.ignoreUnresolvedMention(input);
}

export async function listSourceRecordsForPersonContext(input: {
  ownerUserId: string;
  personId: string;
}) {
  return defaultSourceRecordResolution.listSourceRecordsForPersonContext(input);
}

export async function listSourceRecordReviews(input: ListSourceRecordReviewsInput) {
  const rows = await getDb()
    .select()
    .from(sourceRecords)
    .where(eq(sourceRecords.ownerUserId, input.ownerUserId))
    .orderBy(desc(sourceRecords.createdAt))
    .limit(input.limit ?? 5);

  return rows.map((sourceRecord) => ({
    sourceRecord,
    component: {
      type: "source_record_review",
      sourceRecordId: sourceRecord.id,
    } satisfies SourceRecordReviewComponent,
  }));
}
