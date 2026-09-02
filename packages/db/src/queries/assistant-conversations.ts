import type { AssistantConversationTitleSource } from "@tendnote/domain/assistant-conversations";
import {
  normalizeConversationTitle,
  normalizeFirstMessage,
  placeholderConversationTitle,
} from "@tendnote/domain/assistant-conversations";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../client";
import { assistantConversations } from "../schema";

/**
 * The Assistant's conversation list: Tendnote-owned threads over Eve sessions.
 *
 * Eve has no session index and no title of its own that an application can read
 * back (`$eve.title` is a Vercel Workflow dashboard tag), so every thread the
 * owner can see, name, reopen, or put away is persisted here (ADR 0238).
 *
 * ## Owner scoping
 *
 * A session id is an identifier, never an authorization. Every owner-facing
 * entry point below carries `owner_user_id` in its own `WHERE` clause — the
 * upsert included, through `setWhere` on its conflict path — so naming another
 * owner's session id reads nothing, writes nothing, and is indistinguishable
 * from naming one that does not exist. This is the same rule
 * `eve_session_owners` exists to enforce on Eve's own routes.
 *
 * That includes the two the agent hook calls —`touchAssistantConversation` and
 * `setAssistantConversationTitle`. Running inside the session's own durable
 * execution proves *which session*, not which row: a session id the hook has
 * never seen before may already have a row somebody else pre-claimed by naming
 * the id first, and without `owner_user_id` in the `WHERE` clause the hook would
 * bump that stranger's thread and write this conversation's model title onto it.
 * So the hook passes the owner the channel's own `AuthFn` stamped, and both
 * writes carry it.
 *
 * ## Where the naming rules live
 *
 * The clipping and normalizing below are re-exports from
 * `@tendnote/domain/assistant-conversations`. The browser writes the same
 * placeholder title optimistically the instant eve mints a session id, and this
 * module reaches the database client, so the rules cannot live here and still be
 * the same rules on both sides.
 */

export {
  ASSISTANT_CONVERSATION_FALLBACK_TITLE,
  ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH,
  ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH,
  ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH,
  normalizeConversationTitle,
  normalizeFirstMessage,
  placeholderConversationTitle,
} from "@tendnote/domain/assistant-conversations";
export type { AssistantConversationTitleSource };

export type AssistantConversation = {
  sessionId: string;
  ownerUserId: string;
  title: string;
  titleSource: AssistantConversationTitleSource;
  firstMessage: string | null;
  lastActivityAt: Date;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Default page size for the rail. Deep history is a separate, deliberate read. */
const DEFAULT_LIST_LIMIT = 50;

const SELECTED_COLUMNS = {
  sessionId: assistantConversations.sessionId,
  ownerUserId: assistantConversations.ownerUserId,
  title: assistantConversations.title,
  titleSource: assistantConversations.titleSource,
  firstMessage: assistantConversations.firstMessage,
  lastActivityAt: assistantConversations.lastActivityAt,
  archivedAt: assistantConversations.archivedAt,
  createdAt: assistantConversations.createdAt,
  updatedAt: assistantConversations.updatedAt,
} as const;

/**
 * Record that `ownerUserId` is talking in `sessionId`, creating the thread on
 * first sight and only bumping its activity afterwards.
 *
 * Idempotent by design, because both the web action and the agent hook call it:
 * a conflicting insert updates `last_activity_at` and nothing else, so a title
 * the owner renamed or the model wrote is never reverted to the placeholder,
 * and the opening message stays the *opening* message.
 *
 * The conflict path is owner-scoped (`setWhere`), so a caller naming a session
 * id belonging to somebody else touches no row at all rather than nudging a
 * stranger's thread to the top of their list.
 */
export async function upsertAssistantConversation(input: {
  ownerUserId: string;
  sessionId: string;
  firstMessage?: string | null;
  at?: Date;
}): Promise<void> {
  const at = input.at ?? new Date();
  const firstMessage = normalizeFirstMessage(input.firstMessage);

  await getDb()
    .insert(assistantConversations)
    .values({
      sessionId: input.sessionId,
      ownerUserId: input.ownerUserId,
      title: placeholderConversationTitle(firstMessage ?? ""),
      titleSource: "placeholder",
      firstMessage,
      lastActivityAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: assistantConversations.sessionId,
      set: { lastActivityAt: at, updatedAt: at },
      setWhere: eq(assistantConversations.ownerUserId, input.ownerUserId),
    });
}

/**
 * The owner's conversations, most recently used first. Archived threads are a
 * separate, deliberate read rather than a greyed-out tail of the same list.
 */
export async function listAssistantConversations(input: {
  ownerUserId: string;
  limit?: number;
  includeArchived?: boolean;
}): Promise<AssistantConversation[]> {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIST_LIMIT, 200));
  const ownedByCaller = eq(assistantConversations.ownerUserId, input.ownerUserId);

  return getDb()
    .select(SELECTED_COLUMNS)
    .from(assistantConversations)
    .where(
      input.includeArchived
        ? ownedByCaller
        : and(ownedByCaller, isNull(assistantConversations.archivedAt)),
    )
    .orderBy(desc(assistantConversations.lastActivityAt))
    .limit(limit);
}

/**
 * One thread, archived or not, or `null` when it is missing or somebody else's.
 * Reopening an archived conversation is a legitimate read, so the archive flag
 * is the caller's to render rather than this query's to hide.
 */
export async function getAssistantConversation(input: {
  ownerUserId: string;
  sessionId: string;
}): Promise<AssistantConversation | null> {
  const [row] = await getDb()
    .select(SELECTED_COLUMNS)
    .from(assistantConversations)
    .where(
      and(
        eq(assistantConversations.sessionId, input.sessionId),
        eq(assistantConversations.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * The owner's own name for a thread, recorded as an `owner` title.
 *
 * Any source but `placeholder` is enough to stop the first-turn hook, which only
 * ever replaces a placeholder, from overwriting a rename that landed while the
 * turn was still running. Saying `owner` rather than borrowing `model` is what
 * keeps the column honest: nothing downstream has to guess whether a title the
 * person typed was actually generated.
 */
export async function renameAssistantConversation(input: {
  ownerUserId: string;
  sessionId: string;
  title: string;
}): Promise<AssistantConversation | null> {
  const [row] = await getDb()
    .update(assistantConversations)
    .set({
      title: normalizeConversationTitle(input.title),
      titleSource: "owner",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assistantConversations.sessionId, input.sessionId),
        eq(assistantConversations.ownerUserId, input.ownerUserId),
      ),
    )
    .returning(SELECTED_COLUMNS);

  return row ?? null;
}

/**
 * Put a thread away. Archiving is reversible and destroys nothing: the Eve
 * session is untouched, so an unarchived thread resumes exactly as it was
 * (subject to Eve's session lifetime — see ADR 0238).
 */
export async function archiveAssistantConversation(input: {
  ownerUserId: string;
  sessionId: string;
  at?: Date;
}): Promise<AssistantConversation | null> {
  return setArchivedAt(input, input.at ?? new Date());
}

export async function unarchiveAssistantConversation(input: {
  ownerUserId: string;
  sessionId: string;
}): Promise<AssistantConversation | null> {
  return setArchivedAt(input, null);
}

async function setArchivedAt(
  input: { ownerUserId: string; sessionId: string },
  archivedAt: Date | null,
): Promise<AssistantConversation | null> {
  const [row] = await getDb()
    .update(assistantConversations)
    .set({ archivedAt, updatedAt: new Date() })
    .where(
      and(
        eq(assistantConversations.sessionId, input.sessionId),
        eq(assistantConversations.ownerUserId, input.ownerUserId),
      ),
    )
    .returning(SELECTED_COLUMNS);

  return row ?? null;
}

/**
 * Agent-side: keep the thread's place in the list current as its turns land,
 * and hand back the two fields the first-turn titling path needs.
 *
 * `ownerUserId` is the principal the channel's own `AuthFn` stamped on this
 * session, not an argument any message could influence. It is required for the
 * same reason the owner-facing queries require it: the row is keyed by session
 * id alone, and a session id can be *named* by anyone. Without it, a row
 * pre-claimed under this id by another account would be the row this hook
 * bumped. It deliberately returns the opening message and nothing else a list
 * read would not already show.
 */
export async function touchAssistantConversation(input: {
  ownerUserId: string;
  sessionId: string;
  at?: Date;
}): Promise<{ firstMessage: string | null; titleSource: AssistantConversationTitleSource } | null> {
  const at = input.at ?? new Date();
  const [row] = await getDb()
    .update(assistantConversations)
    .set({ lastActivityAt: at, updatedAt: at })
    .where(
      and(
        eq(assistantConversations.sessionId, input.sessionId),
        eq(assistantConversations.ownerUserId, input.ownerUserId),
      ),
    )
    .returning({
      firstMessage: assistantConversations.firstMessage,
      titleSource: assistantConversations.titleSource,
    });

  return row ?? null;
}

/**
 * Agent-side: replace the placeholder with the model's title, once.
 *
 * `title_source = 'placeholder'` in the `WHERE` clause is the whole idempotency
 * story. A retried turn, a second hook invocation, or a title that arrives after
 * the owner has renamed the thread all update zero rows, so the person's own
 * words always win over the model's.
 *
 * `owner_user_id` sits beside it for the reason `touchAssistantConversation`
 * gives: a model title generated from this conversation must never be able to
 * land on a row belonging to somebody else who named the id first.
 */
export async function setAssistantConversationTitle(input: {
  ownerUserId: string;
  sessionId: string;
  title: string;
  source: "model";
}): Promise<boolean> {
  const rows = await getDb()
    .update(assistantConversations)
    .set({
      title: normalizeConversationTitle(input.title),
      titleSource: input.source,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assistantConversations.sessionId, input.sessionId),
        eq(assistantConversations.ownerUserId, input.ownerUserId),
        eq(assistantConversations.titleSource, "placeholder"),
      ),
    )
    .returning({ sessionId: assistantConversations.sessionId });

  return rows.length > 0;
}
