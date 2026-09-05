import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { eveApprovalMode } from "./enums";

// The audit vocabulary, as tuples so the column type and the zod input schema
// the agent side validates against are one definition rather than two copies
// that have to be kept in agreement by hand.

/** Which side of the Approval Mode line one gated call fell on (#549). */
export const EVE_APPROVAL_DECISION_TIERS = ["reversible_private", "always_ask"] as const;
export type EveApprovalDecisionTier = (typeof EVE_APPROVAL_DECISION_TIERS)[number];

/** What the policy did with a gated call at decision time. */
export const EVE_APPROVAL_DECISION_OUTCOMES = ["parked", "auto_approved", "denied"] as const;
export type EveApprovalDecisionOutcome = (typeof EVE_APPROVAL_DECISION_OUTCOMES)[number];

/** How a parked call ended once the owner answered, or stopped answering. */
export const EVE_APPROVAL_DECISION_SETTLED_OUTCOMES = ["allowed", "cancelled"] as const;
export type EveApprovalDecisionSettledOutcome =
  (typeof EVE_APPROVAL_DECISION_SETTLED_OUTCOMES)[number];

/**
 * One audit row per gated Eve tool call: what was asked, under which Approval
 * Mode, whether the conversation was tainted, and what the policy did (#549).
 *
 * This is a plain audit record and nothing else. It exists so that "why did Eve
 * save that without asking" has an answer, and it is deliberately never read on
 * an owner-facing path - no page, list, or count is built from it, so a row here
 * can never become a disclosure channel.
 *
 * That is also why there is no owner foreign key. A denied call may have no
 * resolved owner at all (an unauthenticated or non-`web_chat` principal is
 * denied opaquely, ADR 0237), and a nullable owner column that is sometimes
 * populated would invite exactly the owner-scoped read this table must not
 * have. The session id is recorded as the model's own identifier for the
 * conversation, not as a claim about who it belongs to.
 *
 * `tier` and the outcomes are `text` rather than PostgreSQL enums on purpose:
 * they are audit vocabulary that will grow as the tier rule is refined, and an
 * audit column that needs a migration to record a new outcome is an audit column
 * that will quietly stop being written.
 *
 * The unique index on (session_id, call_id) is what makes the write idempotent -
 * one eve call id decides once - and, being leading-column ordered on
 * `session_id`, it is also the only index a session-scoped scan needs.
 */
export const eveApprovalDecisions = pgTable(
  "eve_approval_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id").notNull(),
    turnId: text("turn_id").notNull(),
    callId: text("call_id").notNull(),
    toolName: text("tool_name").notNull(),
    tier: text("tier").$type<EveApprovalDecisionTier>().notNull(),
    modeAtDecision: eveApprovalMode("mode_at_decision").notNull(),
    tainted: boolean("tainted").notNull(),
    outcome: text("outcome").$type<EveApprovalDecisionOutcome>().notNull(),
    settledOutcome: text("settled_outcome").$type<EveApprovalDecisionSettledOutcome>(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("eve_approval_decisions_session_call_idx").on(table.sessionId, table.callId),
  ],
);
