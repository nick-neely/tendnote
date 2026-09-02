import type { AssistantConversationTitleSource } from "@tendnote/domain/assistant-conversations";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";

/**
 * A Tendnote-owned Assistant conversation thread over one Eve session.
 *
 * Eve gives every session a durable, resumable event stream but nothing to list
 * it by: there is no session index, no title, and no "sessions for this user"
 * route (eve 0.47.7). `eve_session_owners` already records *who may attach* to a
 * session id; this table records *what the thread is* — its name, when it was
 * last used, and whether the owner has put it away — so the Assistant can offer
 * a conversation list at all (ADR 0238).
 *
 * The Eve session id is the primary key rather than a surrogate, for the same
 * reason it is in `eve_session_owners`: it is globally unique, immutable, and
 * minted before this row exists, so a thread and its session cannot drift apart.
 * A thread is deliberately *not* a transcript. The messages stay in Eve's
 * stream and remain non-authoritative for Tendnote state (ADR 0029); what is
 * persisted here is the handle the owner needs to find the conversation again.
 *
 * `title_source` is what keeps the asynchronous title upgrade idempotent: the
 * first message writes a `placeholder` immediately (zero latency, no model
 * call), and the first-turn hook replaces it once with a `model` title. A row
 * already marked `model` or `owner` is never overwritten — and the two are kept
 * apart rather than folded together so the column stays honest about who named
 * the thread: `owner` is a name the person typed, `model` is one that was
 * generated for them.
 *
 * `first_message` is kept (capped) so a title can be regenerated later without
 * replaying the Eve stream, which is the only other place the text exists.
 *
 * One composite index serves both list reads: the default list adds
 * `archived_at is null` as a residual filter on the same ordered prefix, so a
 * second partial index would only duplicate it at this cardinality.
 */
export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    sessionId: text("session_id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    titleSource: text("title_source")
      .$type<AssistantConversationTitleSource>()
      .notNull()
      .default("placeholder"),
    firstMessage: text("first_message"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("assistant_conversations_owner_activity_idx").on(
      table.ownerUserId,
      table.lastActivityAt.desc(),
    ),
  ],
);
