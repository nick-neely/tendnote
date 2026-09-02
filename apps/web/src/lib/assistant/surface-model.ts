import type { AssistantConversationView } from "@/app/actions/assistant-conversations";
import type { AssistantPageProps } from "@/components/assistant-page";

/**
 * What `/assistant` and `/assistant/[sessionId]` decide once their reads are in.
 *
 * The server component around this owns the awaiting; everything it then has to
 * *judge* lives here, where it can be read and tested without a database: which
 * URLs are a thread that is not there, and what shape the page wants its rows in.
 */

/** The stored columns this surface reads. The rest of the row stays server-side. */
type StoredConversation = {
  sessionId: string;
  title: string;
  lastActivityAt: Date;
  archivedAt: Date | null;
};

export type AssistantSurfaceModel = { found: false } | { found: true; props: AssistantPageProps };

/** Where admission sends the owner back to once they have signed in. */
export function assistantReturnTo(sessionId: string | null): string {
  return sessionId ? `/assistant/${encodeURIComponent(sessionId)}` : "/assistant";
}

/**
 * The page's props, or the verdict that this URL names no thread of theirs.
 *
 * A session id is an identifier, never an authorization (ADR 0238), so the
 * owner-scoped read is the gate: `thread` missing for a named session means the
 * row is not this owner's *or* never existed, and the two must stay
 * indistinguishable so the URL is not an existence oracle (ADR 0219). Answering
 * `found: false` for both is what keeps them that way.
 */
export function assistantSurfaceModel(input: {
  conversations: readonly StoredConversation[];
  hints: { nudges: AssistantPageProps["nudges"]; suggestPersonName: string | null };
  ownerUserId: string;
  sessionId: string | null;
  thread: { sessionId: string } | null;
}): AssistantSurfaceModel {
  if (input.sessionId && !input.thread) return { found: false };

  return {
    found: true,
    props: {
      // Archived threads travel with the rest: the rail hides them behind its own
      // toggle, and reading them is what lets it offer that toggle only when
      // there is something behind it.
      conversations: input.conversations.map(conversationView),
      nudges: input.hints.nudges,
      ownerUserId: input.ownerUserId,
      sessionId: input.sessionId,
      suggestPersonName: input.hints.suggestPersonName,
    },
  };
}

/** The rail's view of a row: archived is a flag here and a timestamp in storage. */
function conversationView(conversation: StoredConversation): AssistantConversationView {
  return {
    archived: conversation.archivedAt !== null,
    lastActivityAt: conversation.lastActivityAt,
    sessionId: conversation.sessionId,
    title: conversation.title,
  };
}
