import {
  getAssistantConversation,
  listAssistantConversations,
} from "@tendnote/db/queries/assistant-conversations";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AssistantPage } from "@/components/assistant-page";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { dashboardAssistantHints } from "@/lib/dashboard-context";

/**
 * Everything `/assistant` and `/assistant/[sessionId]` need from the server,
 * read once and in one place so the two routes cannot drift.
 *
 * The reads here are the owner-scoped queries rather than the server actions:
 * actions exist for the *client's* later refreshes, and calling one from a
 * server component would route a read that already has the owner through a
 * second admission gate for nothing.
 *
 * Two facts shape it. A session id is an identifier, never an authorization
 * (ADR 0238), so `getAssistantConversation` is the gate on a named thread and
 * its answer for someone else's id is `notFound()` — indistinguishable from an
 * id that never existed, which is what keeps the URL from being an existence
 * oracle (ADR 0219). And the transcript is not Tendnote's: nothing here reads
 * messages, because resuming means handing eve's own durable stream the id.
 */
export async function AssistantSurfaceContent({ sessionId }: { sessionId: string | null }) {
  if (process.env.NODE_ENV !== "test") await connection();

  const returnTo = sessionId ? `/assistant/${encodeURIComponent(sessionId)}` : "/assistant";
  const ownerUserId = await requireAdmittedOwner({ returnTo });

  // Archived threads travel with the rest: the rail hides them behind its own
  // toggle, and reading them here is what lets it offer that toggle only when
  // there is something behind it.
  const [conversations, thread, hints] = await Promise.all([
    listAssistantConversations({ ownerUserId, includeArchived: true }),
    sessionId ? getAssistantConversation({ ownerUserId, sessionId }) : Promise.resolve(null),
    dashboardAssistantHints(ownerUserId),
  ]);

  if (sessionId && !thread) notFound();

  return (
    <AssistantPage
      conversations={conversations.map((conversation) => ({
        sessionId: conversation.sessionId,
        title: conversation.title,
        lastActivityAt: conversation.lastActivityAt,
        archived: conversation.archivedAt !== null,
      }))}
      nudges={hints.nudges}
      ownerUserId={ownerUserId}
      sessionId={sessionId}
      suggestPersonName={hints.suggestPersonName}
    />
  );
}
