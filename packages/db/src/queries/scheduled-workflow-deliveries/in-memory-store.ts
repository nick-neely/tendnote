import { randomUUID } from "node:crypto";
import {
  createScheduledWorkflowDeliveryAttemptSchema,
  scheduledWorkflowDeliveryAttemptSchema,
  scheduledWorkflowDeliverySettingSchema,
  upsertScheduledWorkflowDeliverySettingSchema,
} from "@tendnote/domain";
import type { ScheduledWorkflowDeliveryStore } from "./types";

export function createInMemoryScheduledWorkflowDeliveryStore(): ScheduledWorkflowDeliveryStore {
  const settings = new Map<
    string,
    ReturnType<typeof scheduledWorkflowDeliverySettingSchema.parse>
  >();
  const attempts = new Map<
    string,
    ReturnType<typeof scheduledWorkflowDeliveryAttemptSchema.parse>
  >();

  function settingKey(input: { ownerUserId: string; workflow: string; channel: string }) {
    return `${input.ownerUserId}:${input.workflow}:${input.channel}`;
  }

  return {
    async upsertScheduledWorkflowDeliverySetting(input) {
      const parsed = upsertScheduledWorkflowDeliverySettingSchema.parse(input);
      const key = settingKey(parsed);
      const existing = settings.get(key);
      const now = new Date();
      const setting = scheduledWorkflowDeliverySettingSchema.parse({
        ...parsed,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      settings.set(key, setting);
      return setting;
    },

    async getScheduledWorkflowDeliverySetting(input) {
      return settings.get(settingKey(input)) ?? null;
    },

    async listScheduledWorkflowDeliverySettingsForOwner(input) {
      return [...settings.values()].filter((setting) => setting.ownerUserId === input.ownerUserId);
    },

    async createScheduledWorkflowDeliveryAttempt(input) {
      const parsed = createScheduledWorkflowDeliveryAttemptSchema.parse(input);
      const now = new Date();
      const attempt = scheduledWorkflowDeliveryAttemptSchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      attempts.set(attempt.id, attempt);
      return attempt;
    },

    async listScheduledWorkflowDeliveryAttemptsForArtifact(input) {
      return [...attempts.values()].filter(
        (attempt) =>
          attempt.ownerUserId === input.ownerUserId && attempt.artifactId === input.artifactId,
      );
    },

    async listScheduledWorkflowDeliveryAttemptsForOwner(input) {
      return [...attempts.values()].filter(
        (attempt) =>
          attempt.ownerUserId === input.ownerUserId &&
          (input.status === undefined || attempt.status === input.status),
      );
    },
  };
}
