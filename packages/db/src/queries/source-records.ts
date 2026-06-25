import { randomUUID } from "node:crypto";
import {
  type Confidence,
  createSourceRecordSchema,
  type Sensitivity,
  type Source,
  type SourceRecord,
} from "@tendnote/domain";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../client";
import { auditLog, sourceRecords } from "../schema";

export type SourceRecordReviewComponent = {
  type: "source_record_review";
  sourceRecordId: string;
};

export type CaptureSourceRecordInput = {
  ownerUserId: string;
  retainedContent: string;
  sourceType?: Source;
  confidence?: Confidence;
  sensitivity?: Sensitivity;
  metadataJson?: Record<string, unknown>;
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

export type SourceRecordCaptureStore = {
  createSourceRecord: (
    sourceRecord: Omit<SourceRecord, "id" | "createdAt" | "updatedAt">,
  ) => Promise<SourceRecord>;
  getSourceRecord: (input: GetSourceRecordReviewInput) => Promise<SourceRecord | null>;
  createAuditLogEntry: (
    auditLogEntry: Omit<SourceRecordAuditLogEntry, "id" | "createdAt">,
  ) => Promise<SourceRecordAuditLogEntry>;
};

export type InMemorySourceRecordStore = SourceRecordCaptureStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<SourceRecordAuditLogEntry[]>;
};

export function createInMemorySourceRecordStore(): InMemorySourceRecordStore {
  const sourceRecords = new Map<string, SourceRecord>();
  const auditLogEntries: SourceRecordAuditLogEntry[] = [];

  return {
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
        status: "active",
        confidence: input.confidence ?? "medium",
        sensitivity: input.sensitivity ?? "normal",
        scope: "private",
        importance: 3,
        metadataJson: input.metadataJson ?? {},
      });

      const sourceRecord = await store.createSourceRecord(sourceRecordValues);
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

function createDrizzleSourceRecordStore(): SourceRecordCaptureStore {
  return {
    async createSourceRecord(values) {
      const [sourceRecord] = await getDb().insert(sourceRecords).values(values).returning();

      if (!sourceRecord) {
        throw new Error("Failed to capture source record.");
      }

      return sourceRecord;
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
