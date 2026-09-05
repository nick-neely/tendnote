import { getEveApprovalMode } from "@tendnote/db/queries/access-profiles";
import {
  getAssistantConversation,
  listAssistantConversations,
} from "@tendnote/db/queries/assistant-conversations";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AssistantPage } from "@/components/assistant-page";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { assistantReturnTo, assistantSurfaceModel } from "@/lib/assistant/surface-model";
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
 *
 * What to *do* with those reads is `assistantSurfaceModel`, so the one thing a
 * server component cannot be unit-tested for is not also the one thing here
 * making decisions.
 */
export async function AssistantSurfaceContent({ sessionId }: { sessionId: string | null }) {
  if (process.env.NODE_ENV !== "test") await connection();

  const ownerUserId = await requireAdmittedOwner({ returnTo: assistantReturnTo(sessionId) });

  // The Approval Mode joins the same fan-out: it is the owner's own account
  // setting, read here so the panel never fetches it from the browser, and it
  // only ever decides whether a card says one extra sentence.
  const [conversations, thread, hints, approvalMode] = await Promise.all([
    listAssistantConversations({ ownerUserId, includeArchived: true }),
    sessionId ? getAssistantConversation({ ownerUserId, sessionId }) : Promise.resolve(null),
    dashboardAssistantHints(ownerUserId),
    getEveApprovalMode({ userId: ownerUserId }),
  ]);

  const model = assistantSurfaceModel({ conversations, hints, ownerUserId, sessionId, thread });
  if (!model.found) notFound();

  return <AssistantPage {...model.props} approvalMode={approvalMode} />;
}
