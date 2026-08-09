import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import {
  householdMemberStatus,
  householdRole,
  householdStatus,
  privacyScope,
  visibilityRecordKind,
} from "./enums";

export const householdWorkspaces = pgTable(
  "household_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    defaultScope: privacyScope("default_scope").notNull().default("private"),
    /**
     * A dissolved household keeps its row for the recovery window rather than
     * being deleted at the moment it ends, so `status` — not the row's existence
     * — is what says whether a household is still a place.
     */
    status: householdStatus("status").notNull().default("active"),
    dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    /**
     * Deliberately not unique. `owner_user_id` records who created this
     * workspace, which is history and never changes; the rule that a user holds
     * at most one *active* household is a membership rule, enforced by
     * `assertHouseholdAdmissionAvailable`. A unique index here would have meant
     * that dissolving a household — whose row survives its 30-day recovery
     * window — permanently barred its creator from ever starting another.
     */
    index("household_workspaces_owner_user_id_idx").on(table.ownerUserId),
    /** The recovery sweep's access path: dissolved households, oldest first. */
    index("household_workspaces_status_dissolved_at_idx").on(table.status, table.dissolvedAt),
  ],
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
    /**
     * A role this membership has been offered and has not answered.
     *
     * It is a column beside `role` rather than a table because a membership
     * holds at most one live offer, and because an unanswered offer must be
     * incapable of being read as authority: nothing in the product looks at
     * `pending_role` to decide what someone may do. Promotion takes the
     * recipient's acceptance (ADR 0213), and the offer dies with the membership
     * it hangs on — a member who leaves or is removed cannot come back to a
     * question that outlived their standing to answer it.
     */
    pendingRole: householdRole("pending_role"),
    pendingRoleOfferedByUserId: text("pending_role_offered_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    pendingRoleOfferedAt: timestamp("pending_role_offered_at", { withTimezone: true }),
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

/**
 * One active Owner's confirmation that this household should end.
 *
 * Dissolution is unanimous among active Owners (ADR 0213), so the decision is a
 * set of individual confirmations rather than a single flag someone flips. Rows
 * are matched against the roster at the moment unanimity is computed, which is
 * what keeps a confirmation from an owner who has since left or stepped down
 * from counting toward ending a household they no longer govern.
 *
 * Any active Owner calling the dissolution off clears the whole set: an ending
 * that one owner has withdrawn from is not partially agreed, it is not agreed.
 */
export const householdDissolutionConfirmations = pgTable(
  "household_dissolution_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => householdWorkspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("household_dissolution_confirmations_household_user_idx").on(
      table.householdId,
      table.userId,
    ),
  ],
);

export const householdRecordShares = pgTable(
  "household_record_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => householdWorkspaces.id, { onDelete: "cascade" }),
    recordKind: visibilityRecordKind("record_kind").notNull(),
    recordId: uuid("record_id").notNull(),
    sharedWithUserId: text("shared_with_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sharedByUserId: text("shared_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("household_record_shares_record_user_idx").on(
      table.recordKind,
      table.recordId,
      table.sharedWithUserId,
    ),
    index("household_record_shares_household_idx").on(table.householdId),
    index("household_record_shares_user_idx").on(table.sharedWithUserId),
    /** Departure revokes what a member shared as well as what was shared with them. */
    index("household_record_shares_shared_by_idx").on(table.householdId, table.sharedByUserId),
  ],
);
