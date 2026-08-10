import { sql } from "drizzle-orm";
import {
  boolean,
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
import { briefCadence } from "./enums";

/**
 * Tendnote-owned brief schedule rows (PRD #65, issue #72, ADR-0066). Per-user
 * daily and weekly brief timing lives in the database — timezone, next run, lease,
 * retry, and enabled state — while one static root Eve dispatcher schedule claims
 * the due rows in UTC. Storing timing here keeps per-user local-time cadence and
 * duplicate protection out of static cron files.
 */
export const briefSchedules = pgTable(
  "brief_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cadence: briefCadence("cadence").notNull(),
    timezone: text("timezone").notNull(),
    // Minutes after local midnight to run; weekday (0=Sun..6=Sat) for weekly only.
    runAtMinute: integer("run_at_minute").notNull(),
    weekday: integer("weekday"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // The member's own opt-in to a Household Check-in inside this briefing (#390).
    // Off until they ask: the Check-in is offered, never assumed, and no member
    // may turn it on for another (ADR 0220).
    householdCheckinEnabled: boolean("household_checkin_enabled").notNull().default(false),
    // Lease held while a dispatcher run generates this brief; null when free.
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // One schedule per owner and cadence.
    uniqueIndex("brief_schedules_owner_cadence_idx").on(table.ownerUserId, table.cadence),
    // The dispatcher only scans enabled rows, so a partial index by next run keeps
    // the claim lookup lean (mirrors the briefs partial-index convention).
    index("brief_schedules_due_idx").on(table.nextRunAt).where(sql`${table.enabled}`),
  ],
);
