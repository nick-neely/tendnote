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
 * The two exceptions take no owner argument and say so in their names'
 * neighbourhood: `touchAssistantConversation` and
 * `setAssistantConversationTitle` are called by the agent hook from *inside*
 * the session's own durable execution, which is a stronger proof of authority
 * than any argument could be. Neither is reachable from a web request, and
 * neither returns anything an owner-scoped read would not.
 */

/** How the current title was produced, and therefore whether it may be replaced. */
export type AssistantConversationTitleSource = "placeholder" | "model";

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

/** Enough of the opening message to regenerate a title without replaying Eve's stream. */
export const ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH = 500;

/** A rail entry, not a sentence: long enough to be specific, short enough to read at a glance. */
export const ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH = 120;

/** The placeholder is a clipped first message, so it stops well before the stored title cap. */
export const ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH = 60;

/**
 * Shown when the opening message carries no text of its own — an attachment-only
 * turn, or one whose text is entirely whitespace.
 */
export const ASSISTANT_CONVERSATION_FALLBACK_TITLE = "New conversation";

/** Default page size for the rail. Deep history is a separate, deliberate read. */
const DEFAULT_LIST_LIMIT = 50;

/** Below this, a word-boundary cut would throw away most of the placeholder. */
const MIN_WORD_BOUNDARY_OFFSET = 24;

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

/** Collapse the newlines a composer produces so a title stays one line. */
function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clipToCodePoints(text: string, limit: number): string {
  const points = [...text];
  return points.length <= limit ? text : points.slice(0, limit).join("");
}

/**
 * The immediate, free title: the owner's own opening words, clipped on a word
 * boundary. It costs nothing and is right often enough that the model title
 * that replaces it reads as a refinement rather than a correction.
 */
export function placeholderConversationTitle(firstMessage: string): string {
  const normalized = normalizeMessageText(firstMessage);
  if (!normalized) return ASSISTANT_CONVERSATION_FALLBACK_TITLE;

  const points = [...normalized];
  if (points.length <= ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH) return normalized;

  const clipped = points.slice(0, ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH).join("");
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace >= MIN_WORD_BOUNDARY_OFFSET ? clipped.slice(0, lastSpace) : clipped;

  return `${base.replace(/[\s.,;:!?—–-]+$/u, "")}…`;
}

/** The stored form of the opening message: one line, capped, or `null` when empty. */
export function normalizeFirstMessage(firstMessage: string | null | undefined): string | null {
  const normalized = normalizeMessageText(firstMessage ?? "");
  if (!normalized) return null;

  return clipToCodePoints(normalized, ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH);
}

/** The stored form of a title, whoever authored it. Never empty, never overlong. */
export function normalizeConversationTitle(title: string): string {
  const normalized = normalizeMessageText(title);
  if (!normalized) return ASSISTANT_CONVERSATION_FALLBACK_TITLE;

  return clipToCodePoints(normalized, ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH);
}

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
 * The owner's own name for a thread. It is recorded as a `model` title so the
 * first-turn hook, which only ever replaces a `placeholder`, cannot overwrite a
 * rename that landed while the turn was still running.
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
      titleSource: "model",
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
 * It takes no owner argument because its only caller is the hook running inside
 * that session's own durable execution. It deliberately returns the opening
 * message and nothing else that a list read would not already show, so it stays
 * a bad tool for anyone who reached it with a guessed id.
 */
export async function touchAssistantConversation(input: {
  sessionId: string;
  at?: Date;
}): Promise<{ firstMessage: string | null; titleSource: AssistantConversationTitleSource } | null> {
  const at = input.at ?? new Date();
  const [row] = await getDb()
    .update(assistantConversations)
    .set({ lastActivityAt: at, updatedAt: at })
    .where(eq(assistantConversations.sessionId, input.sessionId))
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
 */
export async function setAssistantConversationTitle(input: {
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
        eq(assistantConversations.titleSource, "placeholder"),
      ),
    )
    .returning({ sessionId: assistantConversations.sessionId });

  return rows.length > 0;
}
