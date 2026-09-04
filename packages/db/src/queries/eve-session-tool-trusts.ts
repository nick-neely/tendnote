import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../client";
import { eveSessionToolTrusts } from "../schema";

/**
 * Session Tool Trust: "don't ask again for this tool in this conversation".
 *
 * ## What a trust is worth
 *
 * A Session Tool Trust is not an Owner Approval and not an Approval Mode. It is
 * one user's choice, made on an approval card they had already read, that one
 * named tool may run its Reversible Private Writes for the rest of that one
 * conversation. The policy honours it only for Reversible Private Writes, only
 * in the session it was recorded under, and never in a Tainted Conversation.
 * Nothing here encodes those rules - this module only persists the choice.
 *
 * ## Why the write is one statement
 *
 * A session id is an identifier, never an authorization: the server action that
 * records a trust takes the session id from the browser. So the insert is a
 * single `insert ... select` whose source is `eve_session_owners` filtered by
 * both the session id *and* the owner. A session bound to somebody else and a
 * session that does not exist both select zero rows, so both write nothing and
 * both answer `{ recorded: false }` - one opaque outcome, no oracle for whether
 * a stranger's session id is real (ADR 0219).
 */

/**
 * The longest tool name a trust may be recorded for. Eve tool names are short,
 * fixed identifiers; the bound is here so an attacker-supplied name cannot be
 * used to write arbitrary bulk into the table.
 */
export const EVE_SESSION_TOOL_TRUST_TOOL_NAME_MAX_LENGTH = 120;

const toolNameSchema = z.string().trim().min(1).max(EVE_SESSION_TOOL_TRUST_TOOL_NAME_MAX_LENGTH);

export const recordEveSessionToolTrustInputSchema = z.object({
  ownerUserId: z.string().min(1),
  sessionId: z.string().min(1),
  toolName: toolNameSchema,
});

export type RecordEveSessionToolTrustInput = z.infer<typeof recordEveSessionToolTrustInputSchema>;

/**
 * Record a Session Tool Trust, but only if `eve_session_owners` binds that
 * session to that owner.
 *
 * Idempotent: repeating the same trust re-answers `{ recorded: true }` rather
 * than reporting a failure, because the trust the user asked for does exist. The
 * conflict path rewrites `owner_user_id` from the guard's own row, which is
 * always the value already stored - a session never changes owner - so a repeat
 * is a genuine no-op that still returns the row.
 *
 * An unparseable input answers `{ recorded: false }` for the same reason a
 * foreign session does: the caller learns only that nothing was recorded.
 */
export async function recordEveSessionToolTrust(input: {
  ownerUserId: string;
  sessionId: string;
  toolName: string;
}): Promise<{ recorded: boolean }> {
  const parsed = recordEveSessionToolTrustInputSchema.safeParse(input);
  if (!parsed.success) return { recorded: false };

  const { ownerUserId, sessionId, toolName } = parsed.data;
  const recorded = await getDb().execute(sql<{ session_id: string }>`
    insert into "eve_session_tool_trusts" ("session_id", "owner_user_id", "tool_name")
    select "session_id", "owner_user_id", ${toolName}
    from "eve_session_owners"
    where "session_id" = ${sessionId} and "owner_user_id" = ${ownerUserId}
    on conflict ("session_id", "tool_name") do update set
      "owner_user_id" = excluded."owner_user_id"
    returning "session_id"
  `);

  return { recorded: recorded.length > 0 };
}

/**
 * Whether this conversation already trusts this tool.
 *
 * Deliberately not owner-scoped. The only caller is the approval policy, which
 * is already running inside the session's own durable execution and has proved
 * the principal - re-asking "whose session is this" here would be a second,
 * weaker copy of the binding the write above enforces. Nothing user-facing reads
 * this, so a `true` never reaches anybody who did not already hold the session.
 */
export async function hasEveSessionToolTrust(input: {
  sessionId: string;
  toolName: string;
}): Promise<boolean> {
  const toolName = toolNameSchema.safeParse(input.toolName);
  if (!toolName.success) return false;

  const [row] = await getDb()
    .select({ sessionId: eveSessionToolTrusts.sessionId })
    .from(eveSessionToolTrusts)
    .where(
      and(
        eq(eveSessionToolTrusts.sessionId, input.sessionId),
        eq(eveSessionToolTrusts.toolName, toolName.data),
      ),
    )
    .limit(1);

  return row !== undefined;
}
