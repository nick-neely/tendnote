"use client";

import type { EveApprovalMode, PromptNudge } from "@tendnote/domain";
import { placeholderConversationTitle } from "@tendnote/domain/assistant-conversations";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type AssistantConversationView,
  recordAssistantConversationAction,
} from "@/app/actions/assistant-conversations";
import { AssistantConversationRail } from "@/components/assistant-conversation-rail";
import { AssistantPageHeader } from "@/components/assistant-page-header";
import { AssistantPageTranscriptReserve } from "@/components/assistant-page-reserve";
import { useConversationRailState } from "@/lib/assistant/use-conversation-rail-state";
import { cn } from "@/lib/utils";

/**
 * The Assistant as a destination: a conversation rail beside one centred
 * transcript column.
 *
 * ## Why the page takes the whole window
 *
 * The admitted shell puts every destination inside a 1280px reading measure,
 * which is right for a ledger of cards and wrong for this: at 1440px the rail
 * sat 80px in from the left with nothing beside it and the transcript floated
 * in the middle of two empty margins. `data-full-bleed` (globals.css) is the
 * route's own opt-out of that measure — the same shape the mobile canvas
 * already used, at every width — so the rail meets the left edge of the window
 * and the transcript centres itself in what is left of it.
 *
 * ## Why the panel is not remounted when the URL changes
 *
 * `useEveAgent` reads its config once and never again, so switching threads
 * means remounting the panel with a new `key` (eve's own guidance). That makes
 * the key load-bearing, and it must *not* be the URL: the first message of a new
 * conversation gives Tendnote a session id, and the URL has to become
 * `/assistant/<id>` so a reload lands back in the same thread — but the panel is
 * already holding that session and mid-turn. Keying on the route param would
 * tear down the live stream at exactly the wrong moment.
 *
 * So the key is a client-owned thread key that only a deliberate navigation
 * changes, and the first-message URL update goes through
 * `window.history.replaceState` rather than the router: it syncs `usePathname`
 * without re-running the segment (a documented Next.js escape hatch), so nothing
 * unmounts. Opening a thread from the rail *is* a real navigation, because
 * `/assistant/[sessionId]` is where the owner's claim on that session is checked.
 *
 * The list itself is Tendnote's (ADR 0238). It is seeded from the server read,
 * gains the new thread optimistically the moment eve mints an id, and is re-read
 * once when the first turn settles — that is when the model title replaces the
 * owner's clipped opening words, and the rail is the only place that shows.
 */

/**
 * The panel carries the agent client and the markdown renderer, so it loads as
 * its own chunk behind the same reserve the server streams — the chunk boundary
 * is invisible rather than a second visible loading state.
 */
const AssistantPanel = dynamic(
  () => import("@/components/assistant-panel").then((mod) => mod.AssistantPanel),
  { loading: () => <AssistantPageTranscriptReserve />, ssr: false },
);

const NewAssistantPanel = dynamic(
  () => import("@/components/assistant-panel").then((mod) => mod.AssistantPanel),
  { loading: () => <AssistantPageTranscriptReserve newConversation />, ssr: false },
);

/** One mounted conversation: what to resume, and what identity to key it on. */
type Thread = {
  /** Changes only on a deliberate thread switch, so a URL update never remounts. */
  key: string;
  /** The session to reopen on mount, or `null` for a fresh conversation. */
  resumeSessionId: string | null;
};

export type AssistantPageProps = {
  /**
   * The owner's Approval Mode, read per request by the surface around this page.
   *
   * It travels beside the surface model's props rather than out of it because it
   * is request state read from the owner's own account, not a judgment about
   * which thread this URL names. Absent means the cautious mode, which is also
   * the one the cards say nothing extra about.
   */
  approvalMode?: EveApprovalMode;
  /** Every thread the owner has, archived ones included; split for the rail here. */
  conversations: AssistantConversationView[];
  /** Calendar-derived openings for a brand-new conversation (#114). */
  nudges: PromptNudge[];
  ownerUserId: string;
  /** The thread this URL names, or `null` on `/assistant`. */
  sessionId: string | null;
  suggestPersonName: string | null;
};

/** The transcript's reading measure, centred in whatever the rail leaves. */
const columnClass = "mx-auto w-full max-w-[52rem] px-gutter sm:px-6";

export function AssistantPage({
  approvalMode = "ask",
  conversations: serverConversations,
  nudges,
  ownerUserId,
  sessionId,
  suggestPersonName,
}: AssistantPageProps) {
  const list = useConversationRailState(serverConversations);
  const [thread, setThread] = useState<Thread>(() => ({
    key: sessionId ?? "new",
    resumeSessionId: sessionId,
  }));
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId);
  // The bucket boundaries are calendar-relative; pinning "now" to the mount
  // keeps a row from jumping between headings on an unrelated re-render.
  const [now] = useState(() => new Date());
  const newThreadCount = useRef(0);
  const router = useRouter();

  /**
   * A genuine navigation landed: a rail link, the back button, or a pasted URL.
   *
   * Only the router changes this prop — the first-message `replaceState` below
   * deliberately does not — so reacting to it is what makes the browser's own
   * history work, including moving between two thread URLs that share this one
   * route segment and therefore this one mounted component.
   */
  const routeSession = useRef(sessionId);
  useEffect(() => {
    if (routeSession.current === sessionId) return;
    routeSession.current = sessionId;
    newThreadCount.current += 1;
    setCurrentSessionId(sessionId);
    setThread({
      key: sessionId ?? `new-${newThreadCount.current}`,
      resumeSessionId: sessionId,
    });
  }, [sessionId]);

  function startNewConversation() {
    newThreadCount.current += 1;
    routeSession.current = null;
    setCurrentSessionId(null);
    setThread({ key: `new-${newThreadCount.current}`, resumeSessionId: null });
    // The panel is already fresh; the push is only so the URL, the back button,
    // and a reload all agree about which conversation this is.
    router.push("/assistant");
  }

  /**
   * Eve has just minted a session for this conversation. Claim it as a thread,
   * show it in the rail immediately, and put its id in the URL so a reload comes
   * back here — without disturbing the panel that is mid-turn inside it.
   */
  function claimSession(newSessionId: string, firstMessage: string) {
    setCurrentSessionId(newSessionId);
    list.prepend({
      archived: false,
      lastActivityAt: new Date(),
      sessionId: newSessionId,
      // The placeholder the server is writing at this same moment, from the
      // same shared rule, so the two can never visibly disagree. Showing the
      // owner's own words now, and the model's title when it lands, is the
      // whole two-step ladder (ADR 0238) seen from the rail.
      title: placeholderConversationTitle(firstMessage),
    });
    window.history.replaceState(null, "", `/assistant/${encodeURIComponent(newSessionId)}`);

    void recordAssistantConversationAction({ sessionId: newSessionId, firstMessage })
      // Immediately, so the server's own row — with whatever the agent hook has
      // already written into it — replaces the optimistic guess above.
      .then(list.refresh)
      // Then once more, because the model title is written by the agent hook as
      // the first turn completes and the rail is the only place it shows.
      // Missing it costs a refresh, never the thread.
      .then(() => new Promise((resolve) => setTimeout(resolve, TITLE_SETTLE_MS)))
      .then(list.refresh)
      .catch(() => {
        // The agent hook writes the same row from inside the session, so a failed
        // claim from the browser loses nothing durable.
      });
  }

  const Panel = thread.resumeSessionId ? AssistantPanel : NewAssistantPanel;

  return (
    <>
      <AssistantConversationRail
        archived={list.archived}
        conversations={list.active}
        currentSessionId={currentSessionId}
        now={now}
        onArchive={list.archive}
        onNewConversation={startNewConversation}
        onRename={list.rename}
        onUnarchive={list.unarchive}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AssistantPageHeader
          onNewConversation={startNewConversation}
          title={list.titleOf(currentSessionId)}
        />
        <div className={cn("flex min-h-0 flex-1 flex-col", columnClass)}>
          <Panel
            approvalMode={approvalMode}
            initialSessionId={thread.resumeSessionId ?? undefined}
            key={thread.key}
            nudges={nudges}
            onSessionStarted={claimSession}
            ownerUserId={ownerUserId}
            suggestPersonName={suggestPersonName}
            surface="page"
          />
        </div>
      </div>
    </>
  );
}

/**
 * How long to wait before re-reading the list for the model's title.
 *
 * The agent hook writes it as the first turn completes, and a turn that stops to
 * search takes several seconds — so this is a single deliberate re-read placed
 * after the common case rather than a poll. A title that lands later simply
 * appears on the next visit; a thread is never blocked on having one.
 */
const TITLE_SETTLE_MS = 12_000;
