import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { giftPlanEventKind, giftPlanStatus, privacyScope } from "./enums";
import { householdWorkspaces } from "./households";
import { people } from "./people";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * A member-owned plan for one person and one occasion (#389).
 *
 * It rides the ordinary scoped-record rails — `owner_user_id` / `scope` /
 * `household_id` plus `household_record_shares` for a selected audience — with
 * one column that no other record family has: `surprise_subject_user_id`.
 *
 * That column is the whole of ADR 0216. It is a single nullable user id rather
 * than a join table because a Gift Plan celebrates exactly one person, and a
 * general deny-list is precisely what the ADR refuses to invent. It is read on
 * every access decision through `giftPlanExclusions`, which feeds the Household
 * Authorization Proof's exclusion gate (ADR 0219) — the gate that runs before
 * audience and cannot be reached past, including by this plan's own owner.
 */
export const giftPlans = pgTable(
  "gift_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The owner's deliberately entered, plan-facing snapshot. Never a Person projection. */
    subjectName: text("subject_name").notNull(),
    occasion: text("occasion").notNull(),
    occasionOn: timestamp("occasion_on", { withTimezone: true }),
    /**
     * The owner's own convenience link back to a Person. `set null` rather than
     * `cascade`: deleting a Person must not delete a plan that other people have
     * been contributing to, and the plan holds its own subject name anyway.
     *
     * It is never read for a co-planner. The link grants no access to the
     * Person, their birthday, memories, Assets, or Follow-Ups.
     */
    subjectPersonId: uuid("subject_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    surpriseSubjectUserId: text("surprise_subject_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: giftPlanStatus("status").notNull().default("active"),
    scope: privacyScope("scope").notNull().default("private"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * The optimistic-concurrency token, bumped by every write.
     *
     * A counter rather than `updated_at` because two edits inside one
     * millisecond compare equal as timestamps and the second would silently
     * overwrite the first — the exact race the check exists for.
     */
    revision: integer("revision").notNull().default(0),
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("subject_name", '') || ' ' || coalesce("occasion", ''))`,
      ),
    ...timestamps,
  },
  (table) => [
    index("gift_plans_owner_status_idx").on(table.ownerUserId, table.status),
    index("gift_plans_household_scope_idx").on(table.householdId, table.scope),
    /**
     * The exclusion's own access path. Every list read carries a
     * `surprise_subject_user_id is distinct from :caller` clause as the SQL-side
     * half of the protection, so the column is a filter predicate and not only a
     * stored fact.
     */
    index("gift_plans_surprise_subject_idx").on(table.surpriseSubjectUserId),
    index("gift_plans_search_vector_idx").using("gin", table.searchVector),
  ],
);

/**
 * One idea inside one plan, attributed to whoever entered it.
 *
 * There is no scope trio here on purpose. An idea's audience is its plan's
 * audience, so there is exactly one place the Surprise Subject can be excluded
 * from and exactly one record to prove — a second scope would be a second chance
 * to disagree with the plan about who may see it.
 *
 * `claimed_by_user_id` is the reversible self-claim. It is not an assignment: no
 * due date, no schedule, no completion, and nothing may write it for anyone but
 * the claimant themselves.
 */
export const giftIdeas = pgTable(
  "gift_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    giftPlanId: uuid("gift_plan_id")
      .notNull()
      .references(() => giftPlans.id, { onDelete: "cascade" }),
    /**
     * `set null` would erase attribution the plan is supposed to keep, and
     * `cascade` deletes contributions when an account goes; the account-deletion
     * path is the one that should decide that, so this stays a hard reference.
     */
    contributorUserId: text("contributor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    note: text("note"),
    url: text("url"),
    claimedByUserId: text("claimed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, { onDelete: "set null" }),
    /** See `gift_plans.revision`. */
    revision: integer("revision").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("gift_ideas_plan_created_idx").on(table.giftPlanId, table.createdAt),
    index("gift_ideas_contributor_idx").on(table.contributorUserId),
  ],
);

/**
 * Quiet, plan-local provenance: creator, contributor, last editor, claims, and
 * plan-status changes.
 *
 * Deliberately per-plan and never queried across plans. It is not a household
 * feed, a fairness record, or a productivity history, and the Surprise Subject
 * never reaches it — the trail is read only through the plan, behind the plan's
 * own proof.
 */
export const giftPlanEvents = pgTable(
  "gift_plan_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    giftPlanId: uuid("gift_plan_id")
      .notNull()
      .references(() => giftPlans.id, { onDelete: "cascade" }),
    kind: giftPlanEventKind("kind").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    detailJson: jsonb("detail_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("gift_plan_events_plan_idx").on(table.giftPlanId, table.createdAt)],
);
