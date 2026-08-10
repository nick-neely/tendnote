import { and, asc, desc, eq, gt, inArray, lte, ne } from "drizzle-orm";
import { getDb } from "../../client";
import {
  auditLog,
  reminderDeliveryJobs,
  reminderInstallations,
  reminderOccurrenceIntents,
  reminderOptInStates,
  reminderSchedules,
} from "../../schema";
import {
  reminderDeliveryJobPersistenceValues,
  reminderSchedulePersistenceValues,
} from "./persistence-values";
import type { ReminderAuditEntry, ReminderStore } from "./types";

export function createDrizzleReminderStore(): ReminderStore {
  return {
    async upsertSchedule(input) {
      const [row] = await getDb()
        .insert(reminderSchedules)
        .values(reminderSchedulePersistenceValues(input, input.now))
        .onConflictDoUpdate({
          target: [
            reminderSchedules.ownerUserId,
            reminderSchedules.recordKind,
            reminderSchedules.recordId,
          ],
          set: {
            kind: input.choice.kind,
            localTime: input.choice.kind === "exact" ? input.choice.localTime : null,
            leadMinutes: input.choice.kind === "relative" ? input.choice.leadMinutes : null,
            timeZone: input.timeZone,
            occurrenceKey: input.occurrenceKey,
            intendedAt: input.intendedAt,
            updatedAt: input.now,
          },
        })
        .returning();
      if (!row) throw new Error("Failed to save Reminder Schedule.");
      return row;
    },
    async listSchedules(input) {
      return getDb()
        .select()
        .from(reminderSchedules)
        .where(
          and(
            eq(reminderSchedules.ownerUserId, input.ownerUserId),
            eq(reminderSchedules.recordKind, input.recordKind),
            eq(reminderSchedules.recordId, input.recordId),
          ),
        );
    },
    async listSchedulesForOwner(input) {
      return getDb()
        .select()
        .from(reminderSchedules)
        .where(eq(reminderSchedules.ownerUserId, input.ownerUserId))
        .orderBy(asc(reminderSchedules.intendedAt));
    },
    async listScheduleSubscribers(input) {
      return getDb()
        .select()
        .from(reminderSchedules)
        .where(
          and(
            eq(reminderSchedules.recordKind, input.recordKind),
            eq(reminderSchedules.recordId, input.recordId),
          ),
        )
        .orderBy(asc(reminderSchedules.ownerUserId));
    },
    async getSchedule(input) {
      const [row] = await getDb()
        .select()
        .from(reminderSchedules)
        .where(
          and(
            eq(reminderSchedules.ownerUserId, input.ownerUserId),
            eq(reminderSchedules.id, input.scheduleId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async deleteSchedule(input) {
      await getDb()
        .delete(reminderSchedules)
        .where(
          and(
            eq(reminderSchedules.ownerUserId, input.ownerUserId),
            eq(reminderSchedules.recordKind, input.recordKind),
            eq(reminderSchedules.recordId, input.recordId),
          ),
        );
    },
    async upsertOccurrenceIntent(input) {
      return getDb().transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(reminderOccurrenceIntents)
          .where(
            and(
              eq(reminderOccurrenceIntents.ownerUserId, input.ownerUserId),
              eq(reminderOccurrenceIntents.recordKind, input.recordKind),
              eq(reminderOccurrenceIntents.recordId, input.recordId),
              ne(reminderOccurrenceIntents.status, "superseded"),
            ),
          )
          .orderBy(desc(reminderOccurrenceIntents.createdAt))
          .limit(1);
        if (
          current?.scheduleId === input.scheduleId &&
          current.occurrenceKey === input.occurrenceKey &&
          current.intendedAt.getTime() === input.intendedAt.getTime() &&
          current.freshUntil.getTime() === input.freshUntil.getTime() &&
          current.status === input.status
        ) {
          return current;
        }
        if (current) {
          await tx
            .update(reminderOccurrenceIntents)
            .set({ status: "superseded", updatedAt: input.now })
            .where(
              and(
                eq(reminderOccurrenceIntents.id, current.id),
                eq(reminderOccurrenceIntents.ownerUserId, input.ownerUserId),
              ),
            );
        }
        const values = {
          ownerUserId: input.ownerUserId,
          recordKind: input.recordKind,
          recordId: input.recordId,
          generalActionId: ["general_action", "routine"].includes(input.recordKind)
            ? input.recordId
            : null,
          scheduleId: input.scheduleId,
          occurrenceKey: input.occurrenceKey,
          intendedAt: input.intendedAt,
          freshUntil: input.freshUntil,
          status: input.status,
          createdAt: input.now,
          updatedAt: input.now,
        };
        const [created] = await tx
          .insert(reminderOccurrenceIntents)
          .values(values)
          .onConflictDoNothing()
          .returning();
        if (created) return created;
        const [existing] = await tx
          .select()
          .from(reminderOccurrenceIntents)
          .where(
            and(
              eq(reminderOccurrenceIntents.scheduleId, input.scheduleId),
              eq(reminderOccurrenceIntents.occurrenceKey, input.occurrenceKey),
              eq(reminderOccurrenceIntents.intendedAt, input.intendedAt),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("Failed to replace Reminder occurrence intent.");
        return existing;
      });
    },
    async listOccurrenceIntents(input) {
      return getDb()
        .select()
        .from(reminderOccurrenceIntents)
        .where(
          and(
            eq(reminderOccurrenceIntents.ownerUserId, input.ownerUserId),
            eq(reminderOccurrenceIntents.recordKind, input.recordKind),
            eq(reminderOccurrenceIntents.recordId, input.recordId),
          ),
        )
        .orderBy(asc(reminderOccurrenceIntents.createdAt));
    },
    async listActiveOccurrenceIntentsForOwner(input) {
      return getDb()
        .select()
        .from(reminderOccurrenceIntents)
        .where(
          and(
            eq(reminderOccurrenceIntents.ownerUserId, input.ownerUserId),
            ne(reminderOccurrenceIntents.status, "superseded"),
          ),
        );
    },
    async supersedeOccurrenceIntents(input) {
      await getDb()
        .update(reminderOccurrenceIntents)
        .set({ status: "superseded", updatedAt: input.now })
        .where(
          and(
            eq(reminderOccurrenceIntents.ownerUserId, input.ownerUserId),
            eq(reminderOccurrenceIntents.recordKind, input.recordKind),
            eq(reminderOccurrenceIntents.recordId, input.recordId),
            ne(reminderOccurrenceIntents.status, "superseded"),
          ),
        );
    },
    async getOptInState(input) {
      const [row] = await getDb()
        .select()
        .from(reminderOptInStates)
        .where(
          and(
            eq(reminderOptInStates.ownerUserId, input.ownerUserId),
            eq(reminderOptInStates.clientInstallationId, input.clientInstallationId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async saveOptInState(input) {
      const [row] = await getDb()
        .insert(reminderOptInStates)
        .values(input)
        .onConflictDoUpdate({
          target: [reminderOptInStates.ownerUserId, reminderOptInStates.clientInstallationId],
          set: {
            state: input.state,
            offeredAt: input.offeredAt,
            inviteAfter: input.inviteAfter,
            standaloneContinuationExpiresAt: input.standaloneContinuationExpiresAt,
            updatedAt: input.updatedAt,
          },
        })
        .returning();
      if (!row) throw new Error("Failed to save Reminder Opt-In state.");
      return row;
    },
    async claimStandaloneContinuation(input) {
      return getDb().transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(reminderOptInStates)
          .where(
            and(
              eq(reminderOptInStates.ownerUserId, input.ownerUserId),
              eq(reminderOptInStates.clientInstallationId, input.clientInstallationId),
            ),
          )
          .limit(1)
          .for("update");
        if (target && target.state !== "offered") return null;
        const [source] = await tx
          .select()
          .from(reminderOptInStates)
          .where(
            and(
              eq(reminderOptInStates.ownerUserId, input.ownerUserId),
              eq(reminderOptInStates.state, "offered"),
              gt(reminderOptInStates.standaloneContinuationExpiresAt, input.now),
            ),
          )
          .orderBy(desc(reminderOptInStates.standaloneContinuationExpiresAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!source) return null;
        await tx
          .update(reminderOptInStates)
          .set({ standaloneContinuationExpiresAt: null, updatedAt: input.now })
          .where(eq(reminderOptInStates.id, source.id));
        const [claimed] = await tx
          .insert(reminderOptInStates)
          .values({
            ownerUserId: input.ownerUserId,
            clientInstallationId: input.clientInstallationId,
            state: "offered",
            offeredAt: source.offeredAt,
            inviteAfter: null,
            standaloneContinuationExpiresAt: null,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [reminderOptInStates.ownerUserId, reminderOptInStates.clientInstallationId],
            set: {
              state: "offered",
              offeredAt: source.offeredAt,
              inviteAfter: null,
              standaloneContinuationExpiresAt: null,
              updatedAt: input.now,
            },
          })
          .returning();
        return claimed ?? null;
      });
    },
    async upsertInstallation(input) {
      const [row] = await getDb()
        .insert(reminderInstallations)
        .values({
          ...input,
          status: "enabled",
          previewMode: "generic",
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [reminderInstallations.ownerUserId, reminderInstallations.clientInstallationId],
          set: {
            label: input.label,
            endpoint: input.endpoint,
            p256dh: input.p256dh,
            auth: input.auth,
            expirationTime: input.expirationTime,
            status: "enabled",
            updatedAt: input.now,
          },
        })
        .returning();
      if (!row) throw new Error("Failed to register Reminder Installation.");
      return row;
    },
    async getInstallation(input) {
      const [row] = await getDb()
        .select()
        .from(reminderInstallations)
        .where(
          and(
            eq(reminderInstallations.ownerUserId, input.ownerUserId),
            eq(reminderInstallations.id, input.installationId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async listEnabledInstallationsForOwner(input) {
      return getDb()
        .select()
        .from(reminderInstallations)
        .where(
          and(
            eq(reminderInstallations.ownerUserId, input.ownerUserId),
            eq(reminderInstallations.status, "enabled"),
          ),
        );
    },
    async listInstallationsForOwner(input) {
      return getDb()
        .select()
        .from(reminderInstallations)
        .where(eq(reminderInstallations.ownerUserId, input.ownerUserId))
        .orderBy(desc(reminderInstallations.updatedAt));
    },
    async setInstallationStatus(input) {
      const [row] = await getDb()
        .update(reminderInstallations)
        .set({
          status: input.status,
          ...(input.status === "enabled"
            ? {}
            : { endpoint: null, p256dh: null, auth: null, expirationTime: null }),
          updatedAt: input.now,
        })
        .where(
          and(
            eq(reminderInstallations.ownerUserId, input.ownerUserId),
            eq(reminderInstallations.id, input.installationId),
          ),
        )
        .returning();
      if (!row) throw new Error("Reminder Installation not found.");
      return row;
    },
    async setInstallationPreviewMode(input) {
      const [row] = await getDb()
        .update(reminderInstallations)
        .set({ previewMode: input.previewMode, updatedAt: input.now })
        .where(
          and(
            eq(reminderInstallations.ownerUserId, input.ownerUserId),
            eq(reminderInstallations.clientInstallationId, input.clientInstallationId),
          ),
        )
        .returning();
      if (!row) throw new Error("Reminder Installation not found.");
      return row;
    },
    async suppressInstallationDeliveryJobs(input) {
      return getDb()
        .update(reminderDeliveryJobs)
        .set({ status: "skipped", outcome: "suppressed_revoked", updatedAt: input.now })
        .where(
          and(
            eq(reminderDeliveryJobs.ownerUserId, input.ownerUserId),
            eq(reminderDeliveryJobs.installationId, input.installationId),
            inArray(reminderDeliveryJobs.status, ["pending", "failed", "running"]),
          ),
        )
        .returning();
    },
    async upsertDeliveryJob(input) {
      const [existing] = await getDb()
        .select()
        .from(reminderDeliveryJobs)
        .where(
          and(
            eq(reminderDeliveryJobs.ownerUserId, input.ownerUserId),
            eq(reminderDeliveryJobs.occurrenceKey, input.occurrenceIntent.occurrenceKey),
            eq(reminderDeliveryJobs.installationId, input.installationId),
          ),
        )
        .limit(1);
      if (existing) {
        const rearmAfterDisable =
          ((existing.status === "skipped" && existing.outcome === "suppressed_revoked") ||
            (["skipped", "failed"].includes(existing.status) &&
              existing.outcome === "terminal_endpoint")) &&
          input.occurrenceIntent.freshUntil.getTime() > input.now.getTime();
        const changed =
          rearmAfterDisable ||
          (["pending", "failed"].includes(existing.status) &&
            (existing.occurrenceIntentId !== input.occurrenceIntent.id ||
              existing.intendedAt.getTime() !== input.occurrenceIntent.intendedAt.getTime() ||
              existing.freshUntil.getTime() !== input.occurrenceIntent.freshUntil.getTime()));
        if (!changed) return { job: existing, created: false, changed: false };
        const [replacement] = await getDb()
          .update(reminderDeliveryJobs)
          .set({
            scheduleId: input.occurrenceIntent.scheduleId,
            occurrenceIntentId: input.occurrenceIntent.id,
            intendedAt: input.occurrenceIntent.intendedAt,
            freshUntil: input.occurrenceIntent.freshUntil,
            status: "pending",
            outcome: null,
            attempts: 0,
            nextAttemptAt: input.occurrenceIntent.intendedAt,
            lastErrorCode: null,
            updatedAt: input.now,
          })
          .where(eq(reminderDeliveryJobs.id, existing.id))
          .returning();
        if (!replacement) throw new Error("Failed to replace Reminder delivery job.");
        return { job: replacement, created: false, changed: true };
      }
      const [job] = await getDb()
        .insert(reminderDeliveryJobs)
        .values(reminderDeliveryJobPersistenceValues(input))
        .returning();
      if (!job) throw new Error("Failed to create Reminder delivery job.");
      return { job, created: true, changed: true };
    },
    async listDeliveryJobs(input) {
      return getDb()
        .select()
        .from(reminderDeliveryJobs)
        .where(eq(reminderDeliveryJobs.ownerUserId, input.ownerUserId))
        .orderBy(asc(reminderDeliveryJobs.createdAt));
    },
    async getDeliveryJob(jobId) {
      const [row] = await getDb()
        .select()
        .from(reminderDeliveryJobs)
        .where(eq(reminderDeliveryJobs.id, jobId))
        .limit(1);
      return row ?? null;
    },
    async claimDeliveryJob(input) {
      const [row] = await getDb()
        .update(reminderDeliveryJobs)
        .set({ status: "running", updatedAt: input.now })
        .where(
          and(
            eq(reminderDeliveryJobs.id, input.jobId),
            inArray(reminderDeliveryJobs.status, ["pending", "failed"]),
            lte(reminderDeliveryJobs.nextAttemptAt, input.now),
            lte(reminderDeliveryJobs.intendedAt, input.now),
          ),
        )
        .returning();
      return row ?? null;
    },
    async updateDeliveryJob(input) {
      const [row] = await getDb()
        .update(reminderDeliveryJobs)
        .set({
          status: input.status,
          outcome: input.outcome,
          ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
          ...(input.nextAttemptAt !== undefined ? { nextAttemptAt: input.nextAttemptAt } : {}),
          ...(input.lastErrorCode !== undefined ? { lastErrorCode: input.lastErrorCode } : {}),
          ...(input.acceptedAt !== undefined ? { acceptedAt: input.acceptedAt } : {}),
          updatedAt: input.now,
        })
        .where(eq(reminderDeliveryJobs.id, input.jobId))
        .returning();
      if (!row) throw new Error("Reminder delivery job not found.");
      return row;
    },
    async appendAuditEntry(input) {
      return getDb().transaction(async (tx) => {
        const auditInsert = tx.insert(auditLog);
        const [row] = await auditInsert
          .values({
            ownerUserId: input.ownerUserId,
            action: input.action,
            entityType: "reminder_delivery",
            entityId: input.entityId,
            metadataJson: input.metadata,
            createdAt: input.createdAt,
          })
          .returning();
        if (!row) throw new Error("Failed to append Reminder audit entry.");
        return {
          id: row.id,
          ownerUserId: input.ownerUserId,
          action: input.action,
          entityId: row.entityId,
          metadata: row.metadataJson as ReminderAuditEntry["metadata"],
          createdAt: row.createdAt,
        };
      });
    },
    async listAuditEntries(input) {
      const rows = await getDb()
        .select()
        .from(auditLog)
        .where(eq(auditLog.ownerUserId, input.ownerUserId))
        .orderBy(asc(auditLog.createdAt));
      return rows
        .filter((row) => row.action.startsWith("reminder."))
        .map((row) => ({
          id: row.id,
          ownerUserId: input.ownerUserId,
          action: row.action as ReminderAuditEntry["action"],
          entityId: row.entityId,
          metadata: row.metadataJson as ReminderAuditEntry["metadata"],
          createdAt: row.createdAt,
        }));
    },
  };
}
