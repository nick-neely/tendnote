import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import {
  reminderDeliveryJobStatus,
  reminderDeliveryOutcome,
  reminderInstallationStatus,
  reminderOccurrenceStatus,
  reminderOptInStatus,
  reminderPreviewMode,
  reminderRecordKind,
  reminderScheduleKind,
} from "./enums";
import { generalActions } from "./general-actions";

export const reminderSchedules = pgTable(
  "reminder_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recordKind: reminderRecordKind("record_kind").notNull().default("general_action"),
    recordId: uuid("record_id").notNull(),
    generalActionId: uuid("general_action_id").references(() => generalActions.id, {
      onDelete: "cascade",
    }),
    kind: reminderScheduleKind("kind").notNull(),
    localTime: text("local_time"),
    leadMinutes: integer("lead_minutes"),
    timeZone: text("time_zone").notNull(),
    occurrenceKey: text("occurrence_key").notNull(),
    intendedAt: timestamp("intended_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("reminder_schedules_owner_record_idx").on(
      table.ownerUserId,
      table.recordKind,
      table.recordId,
    ),
    index("reminder_schedules_owner_intended_idx").on(table.ownerUserId, table.intendedAt),
  ],
);

export const reminderOccurrenceIntents = pgTable(
  "reminder_occurrence_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recordKind: reminderRecordKind("record_kind").notNull().default("general_action"),
    recordId: uuid("record_id").notNull(),
    generalActionId: uuid("general_action_id").references(() => generalActions.id, {
      onDelete: "cascade",
    }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => reminderSchedules.id, { onDelete: "cascade" }),
    occurrenceKey: text("occurrence_key").notNull(),
    intendedAt: timestamp("intended_at", { withTimezone: true }).notNull(),
    freshUntil: timestamp("fresh_until", { withTimezone: true }).notNull(),
    status: reminderOccurrenceStatus("status").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("reminder_occurrence_intents_schedule_occurrence_idx").on(
      table.scheduleId,
      table.occurrenceKey,
      table.intendedAt,
    ),
    index("reminder_occurrence_intents_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);

export const reminderOptInStates = pgTable(
  "reminder_opt_in_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientInstallationId: text("client_installation_id").notNull(),
    state: reminderOptInStatus("state").notNull(),
    offeredAt: timestamp("offered_at", { withTimezone: true }).notNull(),
    inviteAfter: timestamp("invite_after", { withTimezone: true }),
    standaloneContinuationExpiresAt: timestamp("standalone_continuation_expires_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("reminder_opt_in_states_owner_installation_idx").on(
      table.ownerUserId,
      table.clientInstallationId,
    ),
  ],
);

export const reminderInstallations = pgTable(
  "reminder_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientInstallationId: text("client_installation_id").notNull(),
    label: text("label").notNull().default("Browser installation"),
    endpoint: text("endpoint"),
    p256dh: text("p256dh"),
    auth: text("auth"),
    expirationTime: bigint("expiration_time", { mode: "number" }),
    status: reminderInstallationStatus("status").notNull().default("enabled"),
    previewMode: reminderPreviewMode("preview_mode").notNull().default("generic"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("reminder_installations_owner_client_idx").on(
      table.ownerUserId,
      table.clientInstallationId,
    ),
    index("reminder_installations_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);

export const reminderDeliveryJobs = pgTable(
  "reminder_delivery_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recordKind: reminderRecordKind("record_kind").notNull().default("general_action"),
    recordId: uuid("record_id").notNull(),
    generalActionId: uuid("general_action_id").references(() => generalActions.id, {
      onDelete: "cascade",
    }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => reminderSchedules.id, { onDelete: "cascade" }),
    occurrenceIntentId: uuid("occurrence_intent_id")
      .notNull()
      .references(() => reminderOccurrenceIntents.id, { onDelete: "cascade" }),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => reminderInstallations.id, { onDelete: "cascade" }),
    occurrenceKey: text("occurrence_key").notNull(),
    intendedAt: timestamp("intended_at", { withTimezone: true }).notNull(),
    freshUntil: timestamp("fresh_until", { withTimezone: true }).notNull(),
    status: reminderDeliveryJobStatus("status").notNull().default("pending"),
    outcome: reminderDeliveryOutcome("outcome"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lastErrorCode: text("last_error_code"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("reminder_delivery_jobs_occurrence_installation_idx").on(
      table.ownerUserId,
      table.occurrenceKey,
      table.installationId,
    ),
    index("reminder_delivery_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("reminder_delivery_jobs_owner_idx").on(table.ownerUserId, table.createdAt),
  ],
);
