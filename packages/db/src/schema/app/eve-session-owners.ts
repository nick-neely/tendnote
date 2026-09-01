import { index, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";

/**
 * Authoritative Eve chat session -> owner binding (security fix: authenticated
 * users must not attach to sessions they did not initiate).
 *
 * Eve's route authentication proves *who* is calling but never *which* session
 * they may touch: every ID-addressed route (follow-up, stream, cancel, compact,
 * clear, reset) attaches to the supplied session id regardless of who created
 * it. This table is the durable authority the channel guard compares against, so
 * a stolen or guessed session id is not authorization. The row is written once,
 * when the session's `session.started` event fires, from the session initiator.
 *
 * The key is Eve's durable workflow run id (its session id), which is globally
 * unique and immutable, so it is the primary key. Only human (`principalType:
 * "user"`) sessions are bound here; scheduled, system, and subagent sessions
 * carry a non-user initiator and are never reachable through the authenticated
 * web attach routes, so they intentionally get no owner row.
 */
export const eveSessionOwners = pgTable(
  "eve_session_owners",
  {
    sessionId: text("session_id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [index("eve_session_owners_owner_user_id_idx").on(table.ownerUserId)],
);
