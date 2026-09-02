"use client";

import type { PromptNudge } from "@tendnote/domain";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AssistantConversationView,
  archiveAssistantConversationAction,
  listAssistantConversationsAction,
  recordAssistantConversationAction,
  renameAssistantConversationAction,
  unarchiveAssistantConversationAction,
} from "@/app/actions/assistant-conversations";
import { AssistantConversationRail } from "@/components/assistant-conversation-rail";
import { AssistantPageTranscriptReserve } from "@/components/assistant-page-reserve";
import {
  ASSISTANT_DEBUG_AVAILABLE,
  ASSISTANT_UNSCOPED_SUBTITLE,
  AssistantDebugToggle,
  AssistantMark,
  AssistantPrivateChip,
} from "@/components/assistant-panel-chrome";
import { ListIcon, NotebookPenIcon, PanelLeftIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  loadAssistantRailCollapsed,
  saveAssistantRailCollapsed,
} from "@/lib/assistant/rail-preference";
import { cn } from "@/lib/utils";

/**
 * The Assistant as a destination: a conversation rail beside one centred
 * transcript column.
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

/** One mounted conversation: what to resume, and what identity to key it on. */
type Thread = {
  /** Changes only on a deliberate thread switch, so a URL update never remounts. */
  key: string;
  /** The session to reopen on mount, or `null` for a fresh conversation. */
  resumeSessionId: string | null;
};

export type AssistantPageProps = {
  /** Every thread the owner has, archived ones included; split for the rail here. */
  conversations: AssistantConversationView[];
  /** Calendar-derived openings for a brand-new conversation (#114). */
  nudges: PromptNudge[];
  ownerUserId: string;
  /** The thread this URL names, or `null` on `/assistant`. */
  sessionId: string | null;
  suggestPersonName: string | null;
};

export function AssistantPage({
  conversations: serverConversations,
  nudges,
  ownerUserId,
  sessionId,
  suggestPersonName,
}: AssistantPageProps) {
  const [conversations, setConversations] = useState(serverConversations);
  const [thread, setThread] = useState<Thread>(() => ({
    key: sessionId ?? "new",
    resumeSessionId: sessionId,
  }));
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railSheetOpen, setRailSheetOpen] = useState(false);
  // The page owns its header, so it owns the dev-only trace toggle that sits in
  // it and hands the state down to the panel that renders the trace.
  const [showDebug, setShowDebug] = useState(false);
  // The bucket boundaries are calendar-relative; pinning "now" to the mount
  // keeps a row from jumping between headings on an unrelated re-render.
  const [now] = useState(() => new Date());
  const newThreadCount = useRef(0);
  const router = useRouter();

  // The stored fold, applied after mount so the server-rendered shell and the
  // first client paint agree. A blocked store simply leaves the rail open.
  useEffect(() => {
    setRailCollapsed(loadAssistantRailCollapsed(globalThis.localStorage));
  }, []);

  // The list is authoritative on the server, so a re-read replaces it outright
  // rather than merging: every local change here already went through an
  // owner-scoped action, so there is no local edit for the server to clobber.
  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await listAssistantConversationsAction({ includeArchived: true }));
    } catch {
      // A list that failed to refresh is a stale title, not a lost conversation.
    }
  }, []);

  const active = useMemo(
    () => conversations.filter((conversation) => !conversation.archived),
    [conversations],
  );
  const archived = useMemo(
    () => conversations.filter((conversation) => conversation.archived),
    [conversations],
  );
  const currentTitle =
    conversations.find((conversation) => conversation.sessionId === currentSessionId)?.title ??
    null;

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
    setRailSheetOpen(false);
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
    setConversations((current) => [
      {
        sessionId: newSessionId,
        // The placeholder the server is writing at this same moment. Showing the
        // owner's own words now, and the model's title when it lands, is the
        // whole two-step ladder (ADR 0238) seen from the rail.
        title: placeholderTitle(firstMessage),
        lastActivityAt: new Date(),
        archived: false,
      },
      ...current.filter((conversation) => conversation.sessionId !== newSessionId),
    ]);
    window.history.replaceState(null, "", `/assistant/${encodeURIComponent(newSessionId)}`);

    void recordAssistantConversationAction({ sessionId: newSessionId, firstMessage })
      // Immediately, so the server's own placeholder replaces the optimistic
      // guess above and the two clipping rules can never visibly disagree.
      .then(refreshConversations)
      // Then once more, because the model title is written by the agent hook as
      // the first turn completes and the rail is the only place it shows.
      // Missing it costs a refresh, never the thread.
      .then(() => new Promise((resolve) => setTimeout(resolve, TITLE_SETTLE_MS)))
      .then(refreshConversations)
      .catch(() => {
        // The agent hook writes the same row from inside the session, so a failed
        // claim from the browser loses nothing durable.
      });
  }

  const rail = (
    <AssistantConversationRail
      archived={archived}
      conversations={active}
      currentSessionId={currentSessionId}
      now={now}
      onArchive={async (id) => {
        await archiveAssistantConversationAction({ sessionId: id });
        setConversations((current) =>
          current.map((conversation) =>
            conversation.sessionId === id ? { ...conversation, archived: true } : conversation,
          ),
        );
      }}
      onNavigate={() => setRailSheetOpen(false)}
      onNewConversation={startNewConversation}
      onRename={async (id, title) => {
        await renameAssistantConversationAction({ sessionId: id, title });
        setConversations((current) =>
          current.map((conversation) =>
            conversation.sessionId === id ? { ...conversation, title } : conversation,
          ),
        );
      }}
      onUnarchive={async (id) => {
        await unarchiveAssistantConversationAction({ sessionId: id });
        setConversations((current) =>
          current.map((conversation) =>
            conversation.sessionId === id ? { ...conversation, archived: false } : conversation,
          ),
        );
      }}
    />
  );

  return (
    // A destination that does not scroll: the transcript scrolls inside its own
    // column and the composer stays put. Below `lg` the shell's fixed bottom bar
    // owns the last 4rem and the safe area with it; above it the admitted main
    // adds its own 4rem of vertical padding under the 3.5rem header.
    <div
      className="flex h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] min-h-0 lg:h-[calc(100dvh-7.5rem)]"
      data-mobile-bleed
    >
      {/* 260px, hairline, and `panel` — the same quiet secondary surface the
          dashboard rail uses, so the page reads as the product at page scale
          rather than as a second design. */}
      <aside
        aria-label="Conversations"
        className={cn(
          "hidden w-[260px] shrink-0 border-r bg-panel lg:block",
          railCollapsed && "lg:hidden",
        )}
      >
        {rail}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AssistantPageHeader
          onNewConversation={startNewConversation}
          onToggleDebug={() => setShowDebug((on) => !on)}
          onOpenRailSheet={() => setRailSheetOpen(true)}
          onToggleRail={() => {
            const next = !railCollapsed;
            setRailCollapsed(next);
            saveAssistantRailCollapsed(globalThis.localStorage, next);
          }}
          railCollapsed={railCollapsed}
          showDebug={showDebug}
          title={currentTitle}
        />
        <div className="mx-auto flex min-h-0 w-full max-w-[44rem] flex-1 flex-col px-gutter sm:px-6">
          <AssistantPanel
            debugOpen={showDebug}
            initialSessionId={thread.resumeSessionId ?? undefined}
            key={thread.key}
            nudges={nudges}
            onSessionStarted={claimSession}
            onToggleDebug={() => setShowDebug((on) => !on)}
            ownerUserId={ownerUserId}
            suggestPersonName={suggestPersonName}
            surface="page"
          />
        </div>
      </div>

      {/* The phone reaches the same rail through the shell's own full-screen
          overlay primitive rather than a second kind of drawer. */}
      <Dialog onOpenChange={setRailSheetOpen} open={railSheetOpen}>
        <DialogContent
          className="inset-0 top-0 left-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-panel p-0"
          showCloseButton={false}
        >
          <DialogDescription className="sr-only">
            Your saved conversations, newest first.
          </DialogDescription>
          <header className="flex min-h-14 items-center justify-between gap-2 border-b px-gutter pt-[env(safe-area-inset-top)]">
            <DialogTitle className="font-semibold text-base">Conversations</DialogTitle>
            <Button onClick={() => setRailSheetOpen(false)} size="sm" type="button" variant="ghost">
              Close
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">{rail}</div>
        </DialogContent>
      </Dialog>
    </div>
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

/**
 * The rail's optimistic first title, for the moment between eve naming the
 * session and Tendnote answering with the row.
 *
 * A deliberate second copy of `placeholderConversationTitle` in
 * `@tendnote/db/queries/assistant-conversations`, which is the authoritative one
 * but reaches the database client and so cannot be imported into the browser.
 * The divergence risk is bounded to that moment: the claim below re-reads the
 * list the instant the row exists, and the server's answer wins from then on.
 */
const PLACEHOLDER_TITLE_MAX_LENGTH = 60;

function placeholderTitle(firstMessage: string): string {
  const normalized = firstMessage.replace(/\s+/g, " ").trim();
  if (!normalized) return "New conversation";

  const points = [...normalized];
  if (points.length <= PLACEHOLDER_TITLE_MAX_LENGTH) return normalized;

  const clipped = points.slice(0, PLACEHOLDER_TITLE_MAX_LENGTH).join("");
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace >= 24 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.replace(/[\s.,;:!?—–-]+$/u, "")}…`;
}

/**
 * One header for the destination: who is talking, which thread, and the standing
 * promise about what happens to it.
 *
 * Its inner row is constrained to the transcript's own width so the thread title
 * and the conversation beneath it share a left edge; the rule under it spans the
 * column, which is what keeps the composer's canvas feeling like a page rather
 * than a floating card.
 */
function AssistantPageHeader({
  onNewConversation,
  onOpenRailSheet,
  onToggleDebug,
  onToggleRail,
  railCollapsed,
  showDebug,
  title,
}: {
  onNewConversation: () => void;
  onOpenRailSheet: () => void;
  onToggleDebug: () => void;
  onToggleRail: () => void;
  railCollapsed: boolean;
  showDebug: boolean;
  title: string | null;
}) {
  return (
    // The page's height already stops above the phone's bottom bar; the top
    // inset has no such owner, so the header holds it and the transcript below
    // simply gets that much less room.
    <header className="shrink-0 border-b pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex min-h-14 w-full max-w-[44rem] items-center gap-2 px-gutter sm:px-6">
        {/* Named for what it opens rather than for the rail's fold state, so it
            is never a second control called "Show conversations". */}
        <Button
          aria-label="Conversations"
          className="text-muted-foreground lg:hidden"
          onClick={onOpenRailSheet}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ListIcon aria-hidden />
        </Button>
        <Button
          aria-label={railCollapsed ? "Show conversations" : "Hide conversations"}
          aria-pressed={railCollapsed}
          className="hidden text-muted-foreground lg:inline-flex"
          onClick={onToggleRail}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PanelLeftIcon aria-hidden />
        </Button>

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="flex shrink-0 items-center gap-2 font-semibold text-sm">
            <AssistantMark />
            Assistant
          </h1>
          {title ? (
            <>
              <span aria-hidden className="text-muted-foreground/60">
                ·
              </span>
              <span className="min-w-0 truncate text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                {title}
              </span>
            </>
          ) : (
            // The standing promise, not a label for anything on screen: a phone
            // header clipping it to "Private. Nothing is…" says less than
            // nothing, and the Private chip beside it already carries the point.
            <span className="hidden min-w-0 truncate text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)] sm:inline">
              {ASSISTANT_UNSCOPED_SUBTITLE}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden sm:inline-flex">
            <AssistantPrivateChip />
          </span>
          {ASSISTANT_DEBUG_AVAILABLE ? (
            <AssistantDebugToggle onPressedChange={onToggleDebug} pressed={showDebug} />
          ) : null}
          {/* The rail already offers this where the rail is on screen. This is the
              same action for the two cases where it is not: a phone, and a folded
              rail on a wide screen. */}
          <Button
            aria-label="New conversation"
            className={cn("text-muted-foreground", !railCollapsed && "lg:hidden")}
            onClick={onNewConversation}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <NotebookPenIcon aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  );
}
