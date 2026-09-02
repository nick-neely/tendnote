"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type AssistantConversationView,
  archiveAssistantConversationAction,
  listAssistantConversationsAction,
  renameAssistantConversationAction,
  unarchiveAssistantConversationAction,
} from "@/app/actions/assistant-conversations";
import type { OwnerActionResult } from "@/lib/owner-action-result";

/**
 * The conversation list the rail renders, and every way it changes.
 *
 * The list is Tendnote's (ADR 0238), so this is the whole of it: seeded from the
 * server read, split for the rail's own archived toggle, gaining a new thread
 * optimistically the moment eve mints an id, and re-read whenever the server has
 * something this browser cannot have guessed - the model's title, or the answer
 * to a mutation it declined.
 */

/** For the failures that carry no owner-facing sentence of their own. */
const MUTATION_FAILED_MESSAGE = "That did not save. Try again in a moment.";

type ThreadChange = Promise<OwnerActionResult<AssistantConversationView | null>>;

export function useConversationRailState(serverConversations: AssistantConversationView[]) {
  const [conversations, setConversations] = useState(serverConversations);

  // The list is authoritative on the server, so a re-read replaces it outright
  // rather than merging: every local change here already went through an
  // owner-scoped action, so there is no local edit for the server to clobber.
  const refresh = useCallback(async () => {
    try {
      const result = await listAssistantConversationsAction({ includeArchived: true });
      if (result.ok) setConversations(result.view);
    } catch {
      // A list that failed to refresh is a stale title, not a lost conversation.
    }
  }, []);

  const apply = useCallback(
    async (pending: ThreadChange) => {
      const saved = await savedThreadRow(pending, refresh);
      if (saved) setConversations(replaceRow(saved));
    },
    [refresh],
  );

  const active = useMemo(
    () => conversations.filter((conversation) => !conversation.archived),
    [conversations],
  );
  const archived = useMemo(
    () => conversations.filter((conversation) => conversation.archived),
    [conversations],
  );

  return {
    active,
    archived,
    /** The row the server saved, applied only once it has agreed to the change. */
    archive: (sessionId: string) => apply(archiveAssistantConversationAction({ sessionId })),
    /** The optimistic first rung of the title ladder, ahead of any server answer. */
    prepend: (conversation: AssistantConversationView) =>
      setConversations((current) => [
        conversation,
        ...current.filter((row) => row.sessionId !== conversation.sessionId),
      ]),
    refresh,
    rename: (sessionId: string, title: string) =>
      apply(renameAssistantConversationAction({ sessionId, title })),
    titleOf: (sessionId: string | null) =>
      conversations.find((conversation) => conversation.sessionId === sessionId)?.title ?? null,
    unarchive: (sessionId: string) => apply(unarchiveAssistantConversationAction({ sessionId })),
  };
}

/**
 * What a rail mutation actually saved, or `null` when there is nothing to apply.
 *
 * `runOwnerAction` answers a refusal as *data* - a rate limit reached, a
 * malformed title - so an unchecked `await` reads as success and leaves the rail
 * asserting a rename or an archive that never happened. `ok` with a `null` view
 * is the second no: the owner-scoped query matched no row, so the thread is gone
 * or was never theirs, and the honest repair is to re-read the list rather than
 * to edit a row the server does not have.
 *
 * A refusal is spoken once as a toast because the rail has nowhere of its own to
 * say it, and the rail's `run` wrapper does not catch - throwing from here would
 * be an unhandled rejection.
 */
async function savedThreadRow(
  pending: ThreadChange,
  refresh: () => Promise<void>,
): Promise<AssistantConversationView | null> {
  let result: OwnerActionResult<AssistantConversationView | null>;
  try {
    result = await pending;
  } catch {
    toast.error(MUTATION_FAILED_MESSAGE);
    return null;
  }

  if (!result.ok) {
    toast.error(result.error);
    return null;
  }
  if (!result.view) {
    toast.error("That conversation is no longer here.");
    await refresh();
    return null;
  }

  return result.view;
}

/** The stored row replaces its own, so the rail shows what was saved. */
function replaceRow(saved: AssistantConversationView) {
  return (current: AssistantConversationView[]) =>
    current.map((conversation) =>
      conversation.sessionId === saved.sessionId ? saved : conversation,
    );
}
