import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { eveSessionOwners } from "./eve-session-owners";

/**
 * A Session Tool Trust: the user's explicit "don't ask again for this in this
 * conversation" for one named Eve tool (#549).
 *
 * It is keyed by the Eve session id plus the tool name, and by nothing else.
 * That is the whole scope of the promise the approval card makes: this one
 * conversation, this one tool, its Reversible Private Writes only. There is
 * deliberately no input, argument hash, or record id in the key - remembering a
 * *particular* approval would make the next call's arguments unreviewed, which
 * is exactly what an Owner Approval is for. And there is no expiry column,
 * because a conversation ending is the expiry.
 *
 * `owner_user_id` is stored even though `eve_session_owners` already binds the
 * session, so a user's rows can be found and cascaded without a join, and so the
 * write itself has an owner to check. The binding is still what authorizes the
 * write: `recordEveSessionToolTrust` inserts only by selecting from
 * `eve_session_owners`, so naming a session id is never authorization to trust a
 * tool in it (the same rule `assistant_conversations` follows).
 *
 * Nothing here is read in a Tainted Conversation. Taint is derived from the
 * message history rather than stored, so a trust row does not have to be revoked
 * when web content is read - the policy simply stops consulting it.
 */
export const eveSessionToolTrusts = pgTable(
  "eve_session_tool_trusts",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => eveSessionOwners.sessionId, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "eve_session_tool_trusts_pkey",
      columns: [table.sessionId, table.toolName],
    }),
    index("eve_session_tool_trusts_owner_user_id_idx").on(table.ownerUserId),
  ],
);
