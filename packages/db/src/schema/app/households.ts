import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { householdMemberStatus, householdRole, privacyScope } from "./enums";

export const householdWorkspaces = pgTable(
  "household_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    defaultScope: privacyScope("default_scope").notNull().default("private"),
    ...timestamps,
  },
  (table) => [uniqueIndex("household_workspaces_owner_user_id_idx").on(table.ownerUserId)],
);

export const householdMemberships = pgTable(
  "household_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => householdWorkspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: householdRole("role").notNull(),
    status: householdMemberStatus("status").notNull(),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("household_memberships_household_user_idx").on(table.householdId, table.userId),
    index("household_memberships_user_status_idx").on(table.userId, table.status),
    index("household_memberships_household_status_idx").on(table.householdId, table.status),
  ],
);
