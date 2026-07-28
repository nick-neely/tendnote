import { todayFeedbackSchema } from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { auditLog, todayFeedback } from "../../schema";
import type { TodayFeedbackRecord, TodayFeedbackStore } from "./types";

function toRecord(row: typeof todayFeedback.$inferSelect): TodayFeedbackRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    candidateIdentity: row.candidateIdentity,
    reasonKey: row.reasonKey,
    kind: row.kind,
    localDate: row.localDate,
    suppressUntil: row.suppressUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleTodayFeedbackStore(): TodayFeedbackStore {
  return {
    async listFeedback(input) {
      const rows = await getDb()
        .select()
        .from(todayFeedback)
        .where(eq(todayFeedback.ownerUserId, input.ownerUserId));
      return rows.map(toRecord);
    },
    async saveFeedback(input) {
      const parsed = todayFeedbackSchema.parse(input);
      return getDb().transaction(async (tx) => {
        const [row] = await tx
          .insert(todayFeedback)
          .values(parsed)
          .onConflictDoUpdate({
            target: [
              todayFeedback.ownerUserId,
              todayFeedback.candidateIdentity,
              todayFeedback.reasonKey,
              todayFeedback.kind,
            ],
            set: {
              localDate: parsed.localDate,
              suppressUntil: parsed.suppressUntil,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (!row) throw new Error("Failed to save Today feedback.");
        await tx.insert(auditLog).values({
          ownerUserId: parsed.ownerUserId,
          action: "today.feedback_saved",
          entityType: "today_candidate",
          entityId: parsed.candidateIdentity,
          metadataJson: {
            kind: parsed.kind,
            reasonKey: parsed.reasonKey,
            localDate: parsed.localDate,
            suppressUntil: parsed.suppressUntil?.toISOString() ?? null,
          },
        });
        return toRecord(row);
      });
    },
    async deleteFeedback(input) {
      return getDb().transaction(async (tx) => {
        const rows = await tx
          .delete(todayFeedback)
          .where(
            and(
              eq(todayFeedback.ownerUserId, input.ownerUserId),
              eq(todayFeedback.candidateIdentity, input.candidateIdentity),
              eq(todayFeedback.reasonKey, input.reasonKey),
              eq(todayFeedback.kind, input.kind),
            ),
          )
          .returning({ id: todayFeedback.id });
        if (rows.length === 0) return false;
        await tx.insert(auditLog).values({
          ownerUserId: input.ownerUserId,
          action: "today.feedback_restored",
          entityType: "today_candidate",
          entityId: input.candidateIdentity,
          metadataJson: {
            kind: input.kind,
            reasonKey: input.reasonKey,
            localDate: input.localDate,
          },
        });
        return true;
      });
    },
  };
}
