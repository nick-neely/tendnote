"use server";

import {
  ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH,
  ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH,
  type AssistantConversation,
  archiveAssistantConversation,
  listAssistantConversations,
  renameAssistantConversation,
  unarchiveAssistantConversation,
  upsertAssistantConversation,
} from "@tendnote/db/queries/assistant-conversations";
import { getEveSessionOwnerUserId } from "@tendnote/db/queries/eve-session-owners";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * The Assistant's conversation list, from the browser's side.
 *
 * Eve mints a session id and forgets it: there is no session index and no
 * per-user listing route, so the browser is the first thing that learns a new
 * conversation exists (`onSessionChange`) and has to tell Tendnote. That is what
 * `recordAssistantConversationAction` is for — a client-supplied *session id*,
 * never a client-supplied owner (ADR 0238).
 *
 * The owner is resolved from the session on every call, through
 * `runOwnerAction`'s admission gate, before a single field of the request is
 * read. Every query underneath then carries that id in its own `WHERE` clause,
 * so naming another owner's session id here writes nothing and reads nothing —
 * it is indistinguishable from naming one that does not exist, which is what
 * keeps this action from being an existence oracle for someone else's threads.
 *
 * A session id is opaque to Tendnote (Eve's durable workflow run id), so it is
 * validated only for shape and length. Nothing here trusts what it says.
 *
 * The one action that can *create* a row goes further and checks the id against
 * `eve_session_owners` first, because a `WHERE owner_user_id = …` clause cannot
 * protect a row that does not exist yet: an insert under a guessed id is how a
 * caller would pre-claim a session eve has not minted, and then hold the row
 * that session's own agent hook later writes its title into.
 */

/** Comfortably longer than any Eve run id, short enough to refuse a runaway string. */
const SESSION_ID_MAX_LENGTH = 200;

const sessionIdSchema = z
  .string()
  .trim()
  .min(1, "Name the conversation to open.")
  .max(SESSION_ID_MAX_LENGTH);

const recordSchema = z.object({
  sessionId: sessionIdSchema,
  firstMessage: z.string().trim().max(20_000).optional(),
});

const sessionSchema = z.object({ sessionId: sessionIdSchema });

const renameSchema = z.object({
  sessionId: sessionIdSchema,
  title: z
    .string()
    .trim()
    .min(1, "Give this conversation a name.")
    .max(ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH),
});

const listSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  includeArchived: z.boolean().optional(),
});

/** What the rail renders. The stored opening message stays server-side. */
export type AssistantConversationView = {
  sessionId: string;
  title: string;
  lastActivityAt: Date;
  archived: boolean;
};

function toAssistantConversationView(
  conversation: AssistantConversation,
): AssistantConversationView {
  return {
    sessionId: conversation.sessionId,
    title: conversation.title,
    lastActivityAt: conversation.lastActivityAt,
    archived: conversation.archivedAt !== null,
  };
}

/**
 * Claim a new Eve session as this owner's conversation, and keep its place in
 * the list current as they keep talking.
 *
 * Called from `onSessionChange` the moment Eve mints an id, so the thread is
 * listable before the first reply lands. The agent hook writes the same row from
 * inside the session; both are idempotent and neither depends on the other
 * arriving first, which is deliberate — the browser is fast, and the hook is the
 * one that cannot be skipped.
 *
 * ## Why the session id is checked before anything is inserted
 *
 * This is the only entry point that creates a row, and it creates it under a
 * string the client chose. Owner scoping cannot help there: a `WHERE` clause
 * filters rows that exist, and the row does not exist yet. So the id is checked
 * against `eve_session_owners` — the binding the session lifecycle hook wrote
 * from inside Eve's own durable execution (ADR 0237) — and an id that is unbound
 * or bound to somebody else records nothing.
 *
 * Nothing is lost by refusing. The hook's own `message.received` upsert creates
 * the same row authoritatively from inside the session, so a claim that arrives
 * before the binding lands (or never arrives at all) costs the rail a moment,
 * not the thread. That is why the refusal is `recorded: false` rather than an
 * error: it is not a failure the person can act on, and saying "no such session"
 * to a caller who guessed one would answer the question they were asking.
 *
 * `firstMessage` is capped by the query layer and is only ever the opening
 * message: a repeat call bumps activity and leaves the stored text and the title
 * exactly as they were.
 */
export async function recordAssistantConversationAction(input: {
  sessionId: string;
  firstMessage?: string;
}) {
  return runOwnerAction({
    schema: recordSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      if ((await getEveSessionOwnerUserId(parsed.sessionId)) !== ownerUserId) {
        return { sessionId: parsed.sessionId, recorded: false };
      }

      await upsertAssistantConversation({
        ownerUserId,
        sessionId: parsed.sessionId,
        firstMessage: parsed.firstMessage?.slice(
          0,
          ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH,
        ),
      });
      return { sessionId: parsed.sessionId, recorded: true };
    },
    result: (recorded) => recorded,
  });
}

/**
 * The owner's conversations, newest activity first.
 *
 * A read, but it goes through the same runner as its siblings rather than
 * hand-rolling the gate: one admission call, one parse, one result shape, and a
 * malformed `limit` comes back as data the rail can ignore instead of as a
 * server-action exception the browser can only render as a generic failure.
 */
export async function listAssistantConversationsAction(input?: {
  limit?: number;
  includeArchived?: boolean;
}) {
  return runOwnerAction({
    schema: listSchema,
    input: input ?? {},
    body: ({ ownerUserId, input: parsed }) =>
      listAssistantConversations({ ownerUserId, ...parsed }),
    result: (conversations) => conversations.map(toAssistantConversationView),
  });
}

/** The owner's own name for a thread, which the first-turn title never overwrites. */
export async function renameAssistantConversationAction(input: {
  sessionId: string;
  title: string;
}) {
  return runOwnerAction({
    schema: renameSchema,
    input,
    budget: { costCategory: "server-action" },
    body: ({ ownerUserId, input: parsed }) =>
      renameAssistantConversation({
        ownerUserId,
        sessionId: parsed.sessionId,
        title: parsed.title,
      }),
    result: (conversation) => (conversation ? toAssistantConversationView(conversation) : null),
  });
}

/**
 * Put a thread away, or bring it back. Nothing is deleted: the Eve session is
 * untouched, so an unarchived conversation opens exactly where it was left.
 */
export async function archiveAssistantConversationAction(input: { sessionId: string }) {
  return runOwnerAction({
    schema: sessionSchema,
    input,
    budget: { costCategory: "server-action" },
    body: ({ ownerUserId, input: parsed }) =>
      archiveAssistantConversation({ ownerUserId, sessionId: parsed.sessionId }),
    result: (conversation) => (conversation ? toAssistantConversationView(conversation) : null),
  });
}

export async function unarchiveAssistantConversationAction(input: { sessionId: string }) {
  return runOwnerAction({
    schema: sessionSchema,
    input,
    budget: { costCategory: "server-action" },
    body: ({ ownerUserId, input: parsed }) =>
      unarchiveAssistantConversation({ ownerUserId, sessionId: parsed.sessionId }),
    result: (conversation) => (conversation ? toAssistantConversationView(conversation) : null),
  });
}
