import {
  createScheduledWorkflowDeliveryAttemptSchema,
  scheduledWorkflowDeliveryAttemptSchema,
  scheduledWorkflowDeliverySettingSchema,
  upsertScheduledWorkflowDeliverySettingSchema,
} from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { scheduledWorkflowDeliveryAttempts, scheduledWorkflowDeliverySettings } from "../../schema";
import type { ScheduledWorkflowDeliveryStore } from "./types";

function toSetting(row: typeof scheduledWorkflowDeliverySettings.$inferSelect) {
  return scheduledWorkflowDeliverySettingSchema.parse(row);
}

function toAttempt(row: typeof scheduledWorkflowDeliveryAttempts.$inferSelect) {
  return scheduledWorkflowDeliveryAttemptSchema.parse(row);
}

export function createDrizzleScheduledWorkflowDeliveryStore(): ScheduledWorkflowDeliveryStore {
  return {
    async upsertScheduledWorkflowDeliverySetting(input) {
      const parsed = upsertScheduledWorkflowDeliverySettingSchema.parse(input);
      const [setting] = await getDb()
        .insert(scheduledWorkflowDeliverySettings)
        .values(parsed)
        .onConflictDoUpdate({
          target: [
            scheduledWorkflowDeliverySettings.ownerUserId,
            scheduledWorkflowDeliverySettings.workflow,
            scheduledWorkflowDeliverySettings.channel,
          ],
          set: {
            enabled: parsed.enabled,
            targetId: parsed.targetId,
            allowSensitive: parsed.allowSensitive,
            targetScope: parsed.targetScope,
            targetHouseholdId: parsed.targetHouseholdId,
            allowPrivateSummary: parsed.allowPrivateSummary,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!setting) {
        throw new Error("Failed to upsert scheduled workflow delivery setting.");
      }

      return toSetting(setting);
    },

    async getScheduledWorkflowDeliverySetting(input) {
      const [setting] = await getDb()
        .select()
        .from(scheduledWorkflowDeliverySettings)
        .where(
          and(
            eq(scheduledWorkflowDeliverySettings.ownerUserId, input.ownerUserId),
            eq(scheduledWorkflowDeliverySettings.workflow, input.workflow),
            eq(scheduledWorkflowDeliverySettings.channel, input.channel),
          ),
        )
        .limit(1);

      return setting ? toSetting(setting) : null;
    },

    async listScheduledWorkflowDeliverySettingsForOwner(input) {
      const rows = await getDb()
        .select()
        .from(scheduledWorkflowDeliverySettings)
        .where(eq(scheduledWorkflowDeliverySettings.ownerUserId, input.ownerUserId));

      return rows.map(toSetting);
    },

    async createScheduledWorkflowDeliveryAttempt(input) {
      const [attempt] = await getDb()
        .insert(scheduledWorkflowDeliveryAttempts)
        .values(createScheduledWorkflowDeliveryAttemptSchema.parse(input))
        .returning();

      if (!attempt) {
        throw new Error("Failed to create scheduled workflow delivery attempt.");
      }

      return toAttempt(attempt);
    },

    async listScheduledWorkflowDeliveryAttemptsForArtifact(input) {
      const rows = await getDb()
        .select()
        .from(scheduledWorkflowDeliveryAttempts)
        .where(
          and(
            eq(scheduledWorkflowDeliveryAttempts.ownerUserId, input.ownerUserId),
            eq(scheduledWorkflowDeliveryAttempts.artifactId, input.artifactId),
          ),
        );

      return rows.map(toAttempt);
    },

    async listScheduledWorkflowDeliveryAttemptsForOwner(input) {
      const rows = await getDb()
        .select()
        .from(scheduledWorkflowDeliveryAttempts)
        .where(
          and(
            eq(scheduledWorkflowDeliveryAttempts.ownerUserId, input.ownerUserId),
            ...(input.status ? [eq(scheduledWorkflowDeliveryAttempts.status, input.status)] : []),
          ),
        );

      return rows.map(toAttempt);
    },
  };
}
