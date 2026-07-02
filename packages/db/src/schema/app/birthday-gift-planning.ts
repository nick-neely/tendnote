import type { Sensitivity } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";

export type BirthdayGiftPlanningProposalJson = {
  id: string;
  personId: string;
  personDisplayName: string;
  birthday: string;
  birthdayDate: string;
  title: string;
  reason: string;
  giftIdeas: string[];
  draftProposal: unknown | null;
  sourceRefs: Array<{ kind: string; id: string; label?: string; trust?: string }>;
  sensitivity: Sensitivity;
  reviewOnly: true;
};

export const birthdayGiftPlanningArtifacts = pgTable(
  "birthday_gift_planning_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    summary: text("summary").notNull(),
    sensitivity: text("sensitivity").$type<Sensitivity>().notNull().default("normal"),
    birthdayKeys: text("birthday_keys").array().notNull(),
    proposals: jsonb("proposals").$type<BirthdayGiftPlanningProposalJson[]>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("birthday_gift_planning_owner_date_current_idx").on(
      table.ownerUserId,
      table.localDate,
    ),
    index("birthday_gift_planning_owner_created_idx").on(table.ownerUserId, table.createdAt),
    check(
      "birthday_gift_planning_artifacts_sensitivity_check",
      sql`${table.sensitivity} in ('normal', 'sensitive', 'restricted')`,
    ),
  ],
);

export const birthdayGiftPlanningSchedules = pgTable(
  "birthday_gift_planning_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    timezone: text("timezone").notNull(),
    runAtMinute: integer("run_at_minute").notNull().default(540),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("birthday_gift_planning_schedules_owner_idx").on(table.ownerUserId),
    index("birthday_gift_planning_schedules_due_idx")
      .on(table.nextRunAt)
      .where(sql`${table.enabled}`),
  ],
);
