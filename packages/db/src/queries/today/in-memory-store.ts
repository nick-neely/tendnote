import { randomUUID } from "node:crypto";
import { todayFeedbackSchema } from "@tendnote/domain";
import type { TodayFeedbackAuditEntry, TodayFeedbackRecord, TodayFeedbackStore } from "./types";

export function createInMemoryTodayFeedbackStore(): TodayFeedbackStore & {
  records: TodayFeedbackRecord[];
  auditEntries: TodayFeedbackAuditEntry[];
} {
  const records: TodayFeedbackRecord[] = [];
  const auditEntries: TodayFeedbackAuditEntry[] = [];
  return {
    records,
    auditEntries,
    async listFeedback(input) {
      return records.filter((record) => record.ownerUserId === input.ownerUserId);
    },
    async saveFeedback(input) {
      const parsed = todayFeedbackSchema.parse(input);
      const existing = records.find(
        (record) =>
          record.ownerUserId === parsed.ownerUserId &&
          record.candidateIdentity === parsed.candidateIdentity &&
          record.reasonKey === parsed.reasonKey &&
          record.kind === parsed.kind,
      );
      const now = new Date();
      if (existing) {
        Object.assign(existing, parsed, { updatedAt: now });
        auditEntries.push(toAuditEntry(parsed));
        return existing;
      }
      const record = { ...parsed, id: randomUUID(), createdAt: now, updatedAt: now };
      records.push(record);
      auditEntries.push(toAuditEntry(parsed));
      return record;
    },
  };
}

function toAuditEntry(input: TodayFeedbackRecord | ReturnType<typeof todayFeedbackSchema.parse>) {
  return {
    ownerUserId: input.ownerUserId,
    action: "today.feedback_saved" as const,
    entityType: "today_candidate" as const,
    entityId: input.candidateIdentity,
    metadataJson: {
      kind: input.kind,
      reasonKey: input.reasonKey,
      localDate: input.localDate,
      suppressUntil: input.suppressUntil?.toISOString() ?? null,
    },
  };
}
