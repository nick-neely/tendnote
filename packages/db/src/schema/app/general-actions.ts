import type {
  GeneralActionAssetHint,
  GeneralActionLink,
  GeneralActionRecurrence,
} from "@tendnote/domain";
import { sql } from "drizzle-orm";
import {
  check,
  customType,
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
import { householdRecordOwnershipCheck, timestamps } from "./common";
import {
  generalActionEventKind,
  generalActionOfferKind,
  generalActionOwnership,
  generalActionStatus,
  privacyScope,
} from "./enums";
import { generalActionAreas } from "./general-action-areas";
import { householdWorkspaces } from "./households";
import { people } from "./people";
import { sourceRecords } from "./source-records";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * General Actions: non-person Personal OS actions such as "replace the
 * refrigerator water filter", kept as their own model separate from
 * person-centered Follow-Ups (ADR 0143). Phase 5 #178 covers private one-time
 * actions; the scope/household columns default to private so shared and household
 * scopes can be added additively later (#180, ADR 0153), mirroring how Follow-Ups
 * gained scope.
 */
export const generalActions = pgTable(
  "general_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The member this row is keyed under, and — for a `member_owned` Action —
     * its author and its authority.
     *
     * For a `household_native` Action it is operational plumbing and nothing
     * more: initially the creator, then a deterministic remaining member if
     * that account is deleted. With no remaining member it stays opaque through
     * dissolution recovery. It is not a member foreign key, provenance, or
     * authority. The owner-keyed read seams exclude household-native rows;
     * access comes only through the Household Authorization Proof (ADR 0214).
     */
    ownerUserId: text("owner_user_id").notNull(),
    /**
     * Whose record this is, as opposed to who may see it. `member_owned` for
     * everything written before Phase Eight and for anything a member writes
     * for themselves; `household_native` for a record the Household Workspace
     * owns, over which every active member holds symmetric authority and which
     * survives its creator's departure with its history intact (ADR 0214).
     */
    ownership: generalActionOwnership("ownership").notNull().default("member_owned"),
    /**
     * The active member a household-native record names as looking after it.
     *
     * `set null` on user delete, and cleared explicitly on departure or removal,
     * because a name is a statement about a current member and Tendnote never
     * chooses a replacement. It gates nothing: any active member may act on the
     * record whoever is named, and history records the real actor (ADR 0215).
     */
    responsibilityHolderUserId: text("responsibility_holder_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * The optimistic fence on occurrence advancement, bumped once per advance.
     *
     * Two members completing the same bin day produce one roll-forward: the
     * second write finds the version moved, does not advance again, and is
     * reconciled against what actually happened. Only the progress paths touch
     * it, so an unrelated edit never invalidates a member's in-flight tap.
     */
    occurrenceVersion: integer("occurrence_version").notNull().default(0),
    title: text("title").notNull(),
    notes: text("notes"),
    // Lightweight links (URL + optional label), not attachment/document
    // management (ADR 0164).
    links: jsonb("links").$type<GeneralActionLink[]>().notNull().default(sql`'[]'::jsonb`),
    status: generalActionStatus("status").notNull().default("open"),
    // A General Action may be unscheduled, so a due date is optional (ADR 0149).
    dueAt: timestamp("due_at", { withTimezone: true }),
    // Resurface date set when the action is deferred (ADR 0149).
    deferUntil: timestamp("defer_until", { withTimezone: true }),
    // Simple recurrence cadence ({ interval, unit }). Non-null makes this a Routine,
    // the product label for a recurring General Action; null is a one-time Action
    // (ADRs 0147, 0148). Not a schedule engine — just the cadence the completion path
    // rolls the due date forward by.
    recurrence: jsonb("recurrence").$type<GeneralActionRecurrence | null>(),
    // Source grounding where present; null for direct user-created actions.
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    // At most one primary Area per Action in Phase 5 (ADR 0146, #179). Nullable —
    // an Action may be unfiled — and set-null on Area delete so the Action survives.
    areaId: uuid("area_id").references(() => generalActionAreas.id, {
      onDelete: "set null",
    }),
    scope: privacyScope("scope").notNull().default("private"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    // Lightweight object/asset hints (subject labels) carried before Asset/Object
    // Memory exists, so a later phase can link or promote them (ADR 0156). Not
    // durable asset records — just labels, like `links` is not document management.
    assetHints: jsonb("asset_hints")
      .$type<GeneralActionAssetHint[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Creator provenance and actor provenance for lifecycle changes (ADR 0154).
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Full-text search vector over the action's title and notes, so General Actions
    // participate in exact recall alongside people, memories, and source records
    // (ADR 0150; Phase 5 #184). Generated/maintained by Postgres like the other
    // search vectors, so it can never drift from the row.
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("notes", ''))`,
      ),
    ...timestamps,
  },
  (table) => [
    index("general_actions_owner_status_idx").on(table.ownerUserId, table.status),
    index("general_actions_owner_due_idx").on(table.ownerUserId, table.dueAt),
    index("general_actions_owner_area_idx").on(table.ownerUserId, table.areaId),
    index("general_actions_household_scope_idx").on(table.householdId, table.scope),
    /**
     * The Household home's access path (#384) and the departure sweep's: the
     * household's own records, by ownership form.
     */
    index("general_actions_household_ownership_idx").on(table.householdId, table.ownership),
    /** Departure clears every record naming the leaving member. */
    index("general_actions_responsibility_holder_idx").on(table.responsibilityHolderUserId),
    index("general_actions_search_vector_idx").using("gin", table.searchVector),
    check("general_actions_ownership_check", householdRecordOwnershipCheck(table)),
  ],
);

/**
 * One member's "no thanks" to an offer this record made them, stored only when
 * the answer was no.
 *
 * Both Phase Eight offers ask a question the member did not go looking for, so
 * both owe the same promise: asked once, and never again once answered. A yes
 * leaves its own durable trace — a `reminder_schedules` row, or a changed
 * Responsibility Holder — and needs nothing here. A no leaves none, so without
 * this table the question would come back every single time the member opened
 * the record, which is precisely the nagging the offers exist to avoid.
 *
 * One table with an `offer_kind` rather than one per offer, because "which
 * questions has this member already answered about this record" is a single
 * concept, and a second table would be a second place to forget to check.
 *
 * Keyed on the member and the record rather than on the occasion, so re-naming
 * the same member, or another occurrence coming round, never re-asks a question
 * they have already answered. Rows cascade with the record and with the member.
 */
export const generalActionOfferDeclines = pgTable(
  "general_action_offer_declines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generalActionId: uuid("general_action_id")
      .notNull()
      .references(() => generalActions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    offerKind: generalActionOfferKind("offer_kind").notNull(),
    declinedAt: timestamp("declined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("general_action_offer_declines_action_user_kind_idx").on(
      table.generalActionId,
      table.userId,
      table.offerKind,
    ),
  ],
);

/**
 * Optional people links on a General Action: a person is attached as *context* (buy
 * a gift for them, book their appointment) without the Action becoming a
 * person-centered Follow-Up (ADR 0155). A lightweight join, not a reconnect
 * relationship — General Actions never appear in follow-up flows by virtue of a
 * link. Rows cascade with either side so a deleted Action or person leaves no
 * dangling link.
 */
export const generalActionPeople = pgTable(
  "general_action_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generalActionId: uuid("general_action_id")
      .notNull()
      .references(() => generalActions.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("general_action_people_action_person_idx").on(
      table.generalActionId,
      table.personId,
    ),
    index("general_action_people_person_idx").on(table.personId),
  ],
);

/**
 * Lifecycle history for a General Action: an append-only trail of what happened
 * and who did it, so Eve and the product can explain an action's story. History
 * without productivity analytics — no scoring, streaks, or predictions (ADR 0165).
 */
export const generalActionEvents = pgTable(
  "general_action_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generalActionId: uuid("general_action_id")
      .notNull()
      .references(() => generalActions.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    kind: generalActionEventKind("kind").notNull(),
    // Actor provenance: who performed this change (ADR 0154).
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    detailJson: jsonb("detail_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("general_action_events_action_idx").on(table.generalActionId, table.createdAt),
    index("general_action_events_owner_idx").on(table.ownerUserId),
  ],
);
