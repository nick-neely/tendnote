import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import {
  phase3ScheduledWorkflow,
  privacyScope,
  proactiveDeliveryChannel,
  proactiveDeliveryStatus,
  scheduledArtifactKind,
} from "./enums";
import { householdWorkspaces } from "./households";

export const scheduledWorkflowDeliverySettings = pgTable(
  "scheduled_workflow_delivery_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workflow: phase3ScheduledWorkflow("workflow").notNull(),
    channel: proactiveDeliveryChannel("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    targetId: text("target_id").notNull(),
    allowSensitive: boolean("allow_sensitive").notNull().default(false),
    targetScope: privacyScope("target_scope").notNull().default("private"),
    targetHouseholdId: uuid("target_household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    allowPrivateSummary: boolean("allow_private_summary").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scheduled_workflow_delivery_settings_owner_workflow_channel_idx").on(
      table.ownerUserId,
      table.workflow,
      table.channel,
    ),
    index("scheduled_workflow_delivery_settings_owner_idx").on(table.ownerUserId),
  ],
);

export const scheduledWorkflowDeliveryAttempts = pgTable(
  "scheduled_workflow_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workflow: phase3ScheduledWorkflow("workflow").notNull(),
    channel: proactiveDeliveryChannel("channel").notNull(),
    artifactKind: scheduledArtifactKind("artifact_kind").notNull(),
    artifactId: text("artifact_id").notNull(),
    targetId: text("target_id"),
    status: proactiveDeliveryStatus("status").notNull(),
    reason: text("reason"),
    error: text("error"),
    ...timestamps,
  },
  (table) => [
    index("scheduled_workflow_delivery_attempts_owner_workflow_idx").on(
      table.ownerUserId,
      table.workflow,
    ),
    index("scheduled_workflow_delivery_attempts_artifact_idx").on(
      table.artifactKind,
      table.artifactId,
    ),
    index("scheduled_workflow_delivery_attempts_status_idx").on(table.status),
  ],
);
