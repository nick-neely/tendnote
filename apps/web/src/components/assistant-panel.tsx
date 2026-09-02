"use client";

import type { PromptNudge } from "@tendnote/domain";
import type { ChatStatus } from "ai";
import { type EveMessage, useEveAgent } from "eve/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Attachment,
  type AttachmentData,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { AssistantAuthorizationCard } from "@/components/assistant-authorization-card";
import { AssistantCaptureMenu } from "@/components/assistant-capture-menu";
import { AssistantDebugTrace } from "@/components/assistant-debug-trace";
import { AssistantEvidenceCapture } from "@/components/assistant-evidence-capture";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { sendNudgeToAgent } from "@/components/assistant-nudge";
import {
  ASSISTANT_DEBUG_AVAILABLE,
  AssistantComposerShell,
  AssistantDebugToggle,
  AssistantEmptyCapture,
  AssistantEndedNotice,
  AssistantPageGreeting,
  AssistantPanelHeader,
  AssistantPanelShell,
  AssistantPrivateChip,
  AssistantResumeSkeleton,
  type AssistantSurface,
  assistantSubtitleFor,
} from "@/components/assistant-panel-chrome";
import { AssistantPromptNudges } from "@/components/assistant-prompt-nudges";
import { AssistantRespondProvider } from "@/components/assistant-respond-context";
import { AssistantSendQueue } from "@/components/assistant-send-queue";
import { AssistantTurnActivity } from "@/components/assistant-turn-activity";
import {
  AssistantTurnActions,
  AssistantTurnFiles,
  AssistantTurnSources,
  AssistantUserTurnActions,
} from "@/components/assistant-turn-chrome";
import { AssistantTurnUnitView } from "@/components/assistant-turn-unit";
import { ArrowUpRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/shimmer";
import { isSessionNotActive } from "@/lib/assistant/session-errors";
import { ASSISTANT_CONVERSATION_STARTERS } from "@/lib/assistant/starters";
import { followUpSuggestions } from "@/lib/eve/follow-up-suggestions";
import {
  isTurnInFlight,
  messageText,
  messageTextSegments,
  messageToolViews,
  messageTurnAnatomy,
} from "@/lib/eve/message-views";
import {
  type SelectedPersonContext,
  selectedPersonClientContext,
} from "@/lib/eve/selected-person-context";
import { EMPTY_SEND_QUEUE, nextQueuedMessage, sendQueueReducer } from "@/lib/eve/send-queue";
import { turnSources } from "@/lib/eve/sources";
import { turnTiming } from "@/lib/eve/turn-timing";
import { turnUnitKey } from "@/lib/eve/turn-unit-key";
import {
  consumeLocalEveDraftSubmission,
  loadLocalComposerDraft,
  saveLocalComposerDraft,
} from "@/lib/local-composer-draft";
import { cn } from "@/lib/utils";

export type AssistantPersonContext = SelectedPersonContext;

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

/** Sends one message as a turn, or refuses. Everything the transcript can do to the session. */
type SendPrompt = (text: string, options?: { steer?: boolean }) => Promise<void>;

export function AssistantPanel({
  context,
  debugOpen,
  initialSessionId,
  onSessionStarted,
  onToggleDebug,
  ownerUserId,
  nudges = [],
  suggestPersonName = null,
  surface = "panel",
}: {
  context?: AssistantPersonContext;
  /**
   * The dev-only turn trace, when a surface outside the panel owns its control.
   *
   * The dashboard panel holds its own header and therefore its own toggle; the
   * Assistant page's header sits above the panel, so it holds the state and
   * hands it down. Uncontrolled unless both of these are supplied.
   */
  debugOpen?: boolean;
  onToggleDebug?: () => void;
  /**
   * A prior Eve session to reopen instead of starting a fresh one.
   *
   * Read exactly once, on mount: `useEveAgent` builds its store the first time
   * it runs and ignores every later config change, so a caller switching threads
   * must remount this component with a new `key` (eve's own guidance). Passing a
   * different id into a mounted panel does nothing, which is deliberately the
   * safe direction — it can never detach a session mid-turn.
   */
  initialSessionId?: string;
  /**
   * Announces the session id the moment Eve mints one for a *new* conversation,
   * with the message that started it.
   *
   * Eve has no session index (ADR 0238), so the browser is the first thing that
   * knows a thread exists and the only thing that can tell Tendnote before the
   * first reply lands. Fires once per panel, and never for a resumed thread —
   * that row already exists.
   */
  onSessionStarted?: (sessionId: string, firstMessage: string) => void;
  ownerUserId: string;
  /** Calendar-derived prompt nudges; clicking one sends its text as a turn (#114). */
  nudges?: PromptNudge[];
  /**
   * A real person from the owner's notebook, used only to make the unscoped
   * composer placeholder concrete. Never a fixture name — when absent the
   * placeholder stays generic rather than naming someone who doesn't exist.
   */
  suggestPersonName?: string | null;
  surface?: AssistantSurface;
}) {
  // A turn that fails does not reject. Eve's store catches the network or stream
  // error itself, parks it on `status: "error"`, and *resolves* `send` - so the
  // composer's restore-on-rejection contract would never fire and the message
  // would be gone with nothing to show for it. `onError` is the store's only
  // signal that the turn it just settled actually failed; we hold the failure
  // here so `handleSubmit` can rethrow it and put the text back.
  const turnFailure = useRef<Error | null>(null);

  // The words that opened this conversation, held until Eve names the session
  // they started. `onSessionChange` carries the id and nothing else, and the
  // title ladder needs the message (ADR 0238).
  const openingMessage = useRef<string | null>(null);
  // The session already announced. Seeded with a resumed id so reattaching to an
  // existing thread never re-announces it as new.
  const announcedSession = useRef<string | undefined>(initialSessionId);

  // A conversation whose Eve session has expired. Its transcript stays readable;
  // its composer must not — see `isSessionNotActive`.
  const [ended, setEnded] = useState(false);

  // Stream turns directly from the same-origin Eve mount (withEve). The hook owns
  // the durable Eve session, so follow-up turns continue the same conversation
  // without a Tendnote chat transcript (ADR 0030). Durable product state still
  // lives in source records, memories, and follow-ups (ADR 0029). A thread the
  // owner reopened rewinds that same durable stream from event 0 rather than
  // replaying a Tendnote copy, which is why resume needs only the id.
  const agent = useEveAgent({
    ...(initialSessionId
      ? { initialSession: { sessionId: initialSessionId, streamIndex: 0 }, resume: true }
      : {}),
    onError: (error) => {
      turnFailure.current = error;
      if (isSessionNotActive(error)) setEnded(true);
    },
    // Re-registered on every render by the hook, so this closure is always the
    // current one and needs no ref of its own.
    onSessionChange: (session) => {
      const sessionId = session?.sessionId;
      if (!sessionId || announcedSession.current === sessionId) return;
      announcedSession.current = sessionId;
      onSessionStarted?.(sessionId, openingMessage.current ?? "");
    },
  });

  // Toggles the turn trace surface (see assistant-debug-trace.tsx) — a developer
  // diagnostic for tool calls and the raw stream, off by default and absent from
  // production builds entirely.
  const [ownDebug, setOwnDebug] = useState(false);
  const showDebug = debugOpen ?? ownDebug;
  const toggleDebug = onToggleDebug ?? (() => setOwnDebug((on) => !on));

  // Messages typed while a turn was running. Eve has no queue of its own, so this
  // is the app's (see lib/eve/send-queue.ts); the effect below drains it.
  const [queue, dispatchQueue] = useReducer(sendQueueReducer, EMPTY_SEND_QUEUE);
  const nextQueueId = useRef(0);

  const composerRef = useRef<HTMLTextAreaElement>(null);

  const messages = agent.data.messages;
  const { send, status } = agent;

  /**
   * Hands one message to Eve and reports the turn's real verdict.
   *
   * `send` resolving says nothing about whether the turn worked, so this rethrows
   * whatever `onError` parked. With `steer`, eve cancels the turn in flight and
   * replaces it - the only way past its one-turn-at-a-time rule.
   */
  const deliver = useCallback<SendPrompt>(
    async (text, options) => {
      // A failure belongs to the turn that produced it. Clearing it as this send
      // starts is what keeps a stale verdict from rejecting the next message; the
      // store retires its own `error` at the same moment.
      turnFailure.current = null;
      openingMessage.current ??= text;

      await send(text, {
        clientContext: selectedPersonClientContext(context),
        ...(options?.steer ? { turnPolicy: "steer" as const } : {}),
      });

      const failure = turnFailure.current;
      if (failure) {
        turnFailure.current = null;
        throw failure;
      }
    },
    [context, send],
  );

  /**
   * The composer's hand-off. A message typed while a turn is running is *queued*
   * rather than refused: it resolves, so the composer clears, and the words are
   * immediately visible in the queue strip above it. Refusing used to be the
   * honest answer because there was nowhere for the message to go; now there is.
   */
  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();

    if (!text) {
      return;
    }

    if (isTurnInFlight(agent.status)) {
      nextQueueId.current += 1;
      dispatchQueue({ id: `queued-${nextQueueId.current}`, text, type: "enqueue" });
      return;
    }

    await deliver(text);
  }

  // Drain one queued message per settled turn, in order. The item leaves the
  // queue as it is handed off - from that moment it is in the transcript, either
  // as a turn or as a "Not sent" bubble - and a failure parks the rest rather
  // than throwing the whole queue at a session that is refusing work.
  useEffect(() => {
    const next = nextQueuedMessage(queue);
    if (!next || status !== "ready") {
      return;
    }
    dispatchQueue({ id: next.id, type: "start" });
    void deliver(next.text)
      .catch(() => dispatchQueue({ type: "pause" }))
      .finally(() => dispatchQueue({ id: next.id, type: "settle" }));
  }, [deliver, queue, status]);

  /** A conversational turn started by something other than the composer. */
  const sendPrompt = useCallback<SendPrompt>(
    async (text, options) => {
      await deliver(text, options).catch(() => {
        // The transcript already says what happened: a failed turn leaves its
        // message as "Not sent" and the status line names the outage.
      });
    },
    [deliver],
  );

  // A prompt nudge starts a conversational turn by sending its text — it never
  // mutates product state or accepts/dismisses a suggestion (#114).
  function sendNudge(prompt: string) {
    sendNudgeToAgent({ status: agent.status, send: agent.send }, context, prompt);
  }

  // Reattaching to a thread's durable stream. It is live work with nothing on
  // screen yet, so the transcript region holds turn-shaped geometry rather than
  // a spinner or, worse, the "nothing has happened yet" greeting.
  const resuming = agent.status === "resuming";

  // A page-scale conversation with nothing in it yet: the composer rises to the
  // middle of the column under a greeting, and settles to the bottom on the
  // first message. Only `page` does this — the dashboard column and the phone
  // sheet are both too short for the move to read as anything but a jump.
  const centeredComposer =
    surface === "page" && !resuming && messages.length === 0 && agent.status === "ready";

  return (
    <PromptInputProvider key={ownerUserId}>
      <AssistantPanelShell id="assistant" surface={surface}>
        {surface === "panel" ? (
          <AssistantHeader
            context={context}
            onToggleDebug={toggleDebug}
            sessionId={agent.session?.sessionId}
            showDebug={showDebug}
          />
        ) : null}

        {/* The leading flex-1 spacer (in AssistantConversation) anchors a short
          conversation to the bottom; it collapses once messages overflow so the
          transcript scrolls normally. Do NOT use `justify-end` here — with
          overflow it traps the top of the transcript out of scroll range. */}
        {/* A turn that parks on an approval is resumed by `respond`, which only this
          session can do - there is exactly one `useEveAgent` in the app. The cards
          read it from here rather than opening a session of their own, which would
          answer a turn nobody is waiting on. `ready` is false while any turn is in
          flight, which is also what serializes the cards: eve refuses a response
          then, so answering one pending request disables every other one until it
          settles. */}
        <AssistantRespondProvider ready={agent.status === "ready"} respond={agent.respond}>
          <Conversation aria-busy={resuming || undefined} className="min-h-0 flex-1">
            <ConversationContent
              className={cn(
                "min-h-full gap-4",
                surface === "panel" && "p-4 sm:p-5",
                surface === "bleed" && "px-gutter py-4",
                // The page column owns its own gutter, so the scroller only
                // opens the distance to the header and the composer.
                surface === "page" && "py-6",
              )}
            >
              {resuming ? (
                <AssistantResumeSkeleton />
              ) : (
                <AssistantConversation
                  busy={isTurnInFlight(agent.status)}
                  composerRef={composerRef}
                  events={agent.events}
                  messages={messages}
                  nudges={nudges}
                  onSend={sendPrompt}
                  onSendNudge={sendNudge}
                  status={agent.status}
                  surface={surface}
                />
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </AssistantRespondProvider>

        {/* Turn trace; toggled from the header, dev builds only. */}
        {ASSISTANT_DEBUG_AVAILABLE && showDebug ? (
          <div className="max-h-80 overflow-auto">
            <AssistantDebugTrace
              error={agent.error}
              events={agent.events}
              messages={messages}
              status={agent.status}
            />
          </div>
        ) : null}

        <AssistantComposerShell surface={surface}>
          {/* A composer that cannot send is worse than no composer: Eve's session
              lifetime is absolute, and a follow-up to an expired one is refused
              at the door (ADR 0238). The transcript above stays exactly as
              readable as it was. */}
          {ended ? (
            <AssistantEndedNotice>
              <Button asChild className="shrink-0" size="sm">
                <Link href="/assistant">Start a new conversation</Link>
              </Button>
            </AssistantEndedNotice>
          ) : (
            <>
              <AssistantSendQueue
                items={queue.items}
                onRemove={(id) => dispatchQueue({ id, type: "remove" })}
                onSendNow={(id) => {
                  const item = queue.items.find((queued) => queued.id === id);
                  if (!item) return;
                  dispatchQueue({ id, type: "remove" });
                  void sendPrompt(item.text, { steer: true });
                }}
              />
              <AssistantComposerForm
                context={context}
                onStop={() => void agent.cancel()}
                onSubmit={handleSubmit}
                ownerUserId={ownerUserId}
                status={agent.status}
                suggestPersonName={suggestPersonName}
                textareaRef={composerRef}
              />
              {centeredComposer ? (
                <div className="pt-3">
                  <AssistantConversationStarters
                    nudges={nudges}
                    onSend={sendPrompt}
                    onSendNudge={sendNudge}
                  />
                </div>
              ) : null}
            </>
          )}
        </AssistantComposerShell>

        {/* The one authored move on this page. The composer sits between the
            transcript region and this spacer, both growing; taking the spacer's
            growth away on the first message slides the composer down to the
            bottom of the column instead of teleporting it there. Reduced motion
            keeps the same two positions and drops the travel. */}
        {surface === "page" ? (
          <div
            aria-hidden
            className="shrink-0 basis-0 transition-[flex-grow] duration-200 ease-(--motion-ease-out) motion-reduce:transition-none"
            style={{ flexGrow: centeredComposer ? 1 : 0 }}
          />
        ) : null}
      </AssistantPanelShell>
    </PromptInputProvider>
  );
}

/**
 * What a brand-new page conversation offers to start with: the calendar's own
 * suggestions where there are any, and three plain openings where there are not.
 *
 * The calendar wins because it knows something — a real meeting this week beats
 * any general prompt — and the fallback exists so an empty week still shows the
 * three things this notebook is for rather than a bare box.
 */
function AssistantConversationStarters({
  nudges,
  onSend,
  onSendNudge,
}: {
  nudges: PromptNudge[];
  onSend: SendPrompt;
  onSendNudge: (prompt: string) => void;
}) {
  if (nudges.length > 0) {
    return <AssistantPromptNudges nudges={nudges} onSelect={onSendNudge} />;
  }

  // Wrapped and centred rather than in the `Suggestions` scroller: three full
  // sentences overflow a 44rem column, and a chip clipped at the column edge
  // reads as broken rather than as scrollable. The chips themselves are the
  // same primitive the nudges use.
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {ASSISTANT_CONVERSATION_STARTERS.map((starter) => (
        <Suggestion key={starter} onClick={(text) => void onSend(text)} suggestion={starter} />
      ))}
    </div>
  );
}

function AssistantHeader({
  context,
  sessionId,
  showDebug,
  onToggleDebug,
}: {
  context?: AssistantPersonContext;
  /** The live thread, so "Open" lands in *this* conversation rather than a new one. */
  sessionId?: string;
  showDebug: boolean;
  onToggleDebug: () => void;
}) {
  return (
    <AssistantPanelHeader
      actions={
        <>
          <AssistantPrivateChip />
          {/* Developer trace toggle for the turn (tool calls + raw stream). */}
          {ASSISTANT_DEBUG_AVAILABLE ? (
            <AssistantDebugToggle onPressedChange={onToggleDebug} pressed={showDebug} />
          ) : null}
          <Button
            aria-label={
              sessionId ? "Open this conversation on the Assistant page" : "Open the Assistant page"
            }
            asChild
            className="text-muted-foreground hover:text-primary"
            size="icon-sm"
            variant="ghost"
          >
            {/* A conversation already under way follows the owner to the page
                rather than being abandoned for a blank one. */}
            <Link href={sessionId ? `/assistant/${encodeURIComponent(sessionId)}` : "/assistant"}>
              <ArrowUpRightIcon aria-hidden />
            </Link>
          </Button>
        </>
      }
      subtitle={assistantSubtitleFor(context?.personName)}
    />
  );
}

/** The live conversation, or the empty state before a first turn exists. */
function AssistantConversation({
  busy,
  composerRef,
  events,
  messages,
  nudges,
  onSend,
  onSendNudge,
  status,
  surface,
}: {
  busy: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  events: readonly unknown[];
  messages: readonly EveMessage[];
  nudges: PromptNudge[];
  onSend: SendPrompt;
  onSendNudge: (prompt: string) => void;
  status: AgentStatus;
  surface: AssistantSurface;
}) {
  // The empty state means "nothing has happened yet" - so it yields as soon as
  // anything has, including a turn that failed before producing a message. An
  // error the panel silently replaced with a greeting would be the worst of both:
  // no answer and no explanation.
  if (messages.length === 0 && status === "ready") {
    // On the page the greeting hugs a composer that has risen to meet it, and the
    // starters sit below that composer - so this half of the empty state is only
    // the words. Everywhere else the whole invitation is centred in the panel.
    return surface === "page" ? (
      <AssistantPageGreeting />
    ) : (
      <AssistantEmptyCapture>
        <AssistantPromptNudges nudges={nudges} onSelect={onSendNudge} />
      </AssistantEmptyCapture>
    );
  }

  // Only the last message can be the one the assistant is still writing, so it is
  // the only one allowed to show work in progress - and only while the turn is
  // live. Every earlier turn is finished history, however its tool parts happened
  // to end.
  const liveIndex = isTurnInFlight(status) ? messages.length - 1 : -1;

  return (
    <>
      <div aria-hidden className="min-h-0 flex-1" />
      {messages.map((message, index) => (
        <MessageTurn
          busy={busy}
          composerRef={composerRef}
          events={events}
          key={message.id}
          live={index === liveIndex}
          message={message}
          onSend={onSend}
          // Follow-ups belong to the turn that just finished and nothing else. A
          // chip under an older turn would offer a next step the conversation has
          // already moved past.
          showFollowUps={index === messages.length - 1 && status === "ready"}
          userPrompt={precedingUserPrompt(messages, index)}
        />
      ))}
      <TurnStatus status={status} />
    </>
  );
}

/** The message that started this assistant turn, for Retry. */
function precedingUserPrompt(messages: readonly EveMessage[], index: number): string | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    const message = messages[at];
    if (message?.role === "user") {
      const text = messageText(message).trim();
      return text.length > 0 ? text : null;
    }
  }
  return null;
}

/** One conversation turn: the user prompt, or the assistant's whole anatomy. */
function MessageTurn({
  busy,
  composerRef,
  events,
  live,
  message,
  onSend,
  showFollowUps,
  userPrompt,
}: {
  busy: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  events: readonly unknown[];
  live: boolean;
  message: EveMessage;
  onSend: SendPrompt;
  showFollowUps: boolean;
  userPrompt: string | null;
}) {
  if (message.role === "user") {
    return <UserTurn composerRef={composerRef} message={message} />;
  }

  return (
    <AssistantTurn
      busy={busy}
      events={events}
      live={live}
      message={message}
      onSend={onSend}
      showFollowUps={showFollowUps}
      userPrompt={userPrompt}
    />
  );
}

function UserTurn({
  composerRef,
  message,
}: {
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  message: EveMessage;
}) {
  const controller = usePromptInputController();
  const text = messageText(message);

  // A submission that never reached Eve stays in the transcript looking exactly
  // like one that landed, which quietly lies about what happened. Name it: the
  // bubble trades its sage fill for a dashed hairline - the same "provisional,
  // nothing here yet" language the empty states use - and carries a plain "Not
  // sent" line. No destructive red: nothing broke in the notebook, and the
  // words are already back in the composer to send again. The fill has to go
  // to transparent rather than to a neutral one; `muted`, `secondary`, and
  // `panel` are one value, so a neutral bubble would vanish into the panel.
  const notSent = message.metadata?.status === "failed";

  return (
    <div className="group/turn flex flex-col gap-1">
      <Message from="user">
        <MessageContent
          className={cn(
            notSent &&
              "group-[.is-user]:border group-[.is-user]:border-border group-[.is-user]:border-dashed group-[.is-user]:bg-transparent group-[.is-user]:text-muted-foreground",
          )}
        >
          {text}
        </MessageContent>
        {notSent ? (
          <span className="ml-auto text-[length:var(--text-caption)] text-muted-foreground">
            Not sent
          </span>
        ) : null}
      </Message>
      {text.trim() ? (
        <AssistantUserTurnActions
          onEdit={() => {
            controller.textInput.setInput(text);
            composerRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One assistant turn, in anatomical order: what it was doing, what it said, what
 * it produced, what it read, what you can do with it, and where to go next.
 *
 * The order is the point. Tool activity used to trail *below* the answer as bare
 * lines, so a reply ended on housekeeping; now it is a collapsed disclosure above
 * the text, and only durable results stay underneath as the payload.
 */
function AssistantTurn({
  busy,
  events,
  live,
  message,
  onSend,
  showFollowUps,
  userPrompt,
}: {
  busy: boolean;
  events: readonly unknown[];
  live: boolean;
  message: EveMessage;
  onSend: SendPrompt;
  showFollowUps: boolean;
  userPrompt: string | null;
}) {
  // Each agent step contributes its own text part, so a turn that stops to run
  // tools says several separate things. Render them as separate blocks - running
  // them into one string is what produced "…about Jordan Rivera.Found them!".
  const segments = messageTextSegments(message);
  const anatomy = messageTurnAnatomy(message, live);
  const sources = useMemo(() => turnSources(message), [message]);
  const suggestions = useMemo(
    () =>
      showFollowUps ? followUpSuggestions(messageToolViews(message).map((it) => it.view)) : [],
    [message, showFollowUps],
  );
  // Durable, replay-stable durations. `null` while the turn is still running, and
  // the disclosure falls back to its own clock until the stream says otherwise.
  const timing = useMemo(
    () => turnTiming(events, message.metadata?.turnId),
    [events, message.metadata?.turnId],
  );

  const answer = segments.map((segment) => segment.text).join("\n\n");

  return (
    <div className="group/turn flex flex-col gap-2.5">
      <AssistantTurnActivity
        durationSeconds={timing.turnSeconds}
        reasoning={anatomy.reasoning}
        steps={anatomy.activity}
        streaming={live}
      />
      {segments.length > 0 ? (
        <Message from="assistant">
          {/* gap-3 matches the paragraph rhythm inside a segment, so one long
              answer and several short ones breathe the same way. */}
          <MessageContent className="gap-3">
            {segments.map((segment) => (
              <AssistantMarkdown key={segment.key}>{segment.text}</AssistantMarkdown>
            ))}
          </MessageContent>
        </Message>
      ) : null}
      <AssistantTurnFiles files={anatomy.files} />
      {/* Everything the turn produced that carries durable state, in the order it
          happened: result cards, calls parked on the owner's approval, and settled
          approvals. Runs of same-kind durable saves still fold into one collapsed
          group so a busy capture turn reads as a short summary by default. */}
      {anatomy.cards.map((unit) => (
        <AssistantTurnUnitView key={turnUnitKey(message.id, unit)} unit={unit} />
      ))}
      {/* A turn stopped for a sign-in the owner has to complete elsewhere. These
          used to render as nothing at all, so the turn simply looked broken. */}
      {anatomy.authorizations.map((part) => (
        <AssistantAuthorizationCard
          isNew
          key={`${part.name}:${part.stepIndex}:${part.state}`}
          part={part}
        />
      ))}
      <AssistantTurnSources sources={sources} />
      {!live && (answer || userPrompt) ? (
        <AssistantTurnActions
          answer={answer}
          onRetry={userPrompt ? () => void onSend(userPrompt) : null}
          retryDisabled={busy}
        />
      ) : null}
      {suggestions.length > 0 ? (
        <Suggestions className="pt-0.5">
          {suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion}
              onClick={(text) => void onSend(text)}
              suggestion={suggestion}
            />
          ))}
        </Suggestions>
      ) : null}
    </div>
  );
}

/** Transient shimmer line for the pre-token wait. */
function WorkingLine({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
      />
      <Shimmer>{label}</Shimmer>
    </p>
  );
}

/**
 * Defers a transient flag so it only shows after `delay` and, once shown, stays
 * for at least `minVisible`. The assistant often answers in under a beat; without
 * this the "Thinking…" shimmer flickers on and off in a blink. A fast turn never
 * trips `delay`, so the shimmer simply never appears; a slower one shows steadily.
 */
function useDeferredFlag(active: boolean, { delay = 350, minVisible = 450 } = {}): boolean {
  const [show, setShow] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active === show) {
      return;
    }

    if (active) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShow(true);
      }, delay);
      return () => clearTimeout(timer);
    }

    const remaining = Math.max(0, minVisible - (Date.now() - shownAt.current));
    const timer = setTimeout(() => setShow(false), remaining);
    return () => clearTimeout(timer);
  }, [active, show, delay, minVisible]);

  return show;
}

/** Live turn status: a shimmer while a turn spins up, or a reach error. */
function TurnStatus({ status }: { status: AgentStatus }) {
  const thinking = useDeferredFlag(status === "submitted");

  if (status === "error") {
    return (
      <p
        className="text-[length:var(--text-small)] text-destructive leading-[var(--text-small-line)]"
        role="alert"
      >
        The assistant is unavailable. Your records are safe, and your question wasn't saved. Try
        again in a moment.
      </p>
    );
  }

  return thinking ? <WorkingLine label="Thinking…" /> : null;
}

/**
 * Composer placeholder, most specific first: the person this panel is scoped to,
 * then a real name suggested by the caller, then a generic prompt. It never
 * invents a name, so an empty notebook is never told about someone it has no
 * record of.
 */
function composerPlaceholder(
  context: AssistantPersonContext | undefined,
  suggestPersonName: string | null,
) {
  if (context) {
    return `Note something about ${context.personName}…`;
  }

  return suggestPersonName
    ? `Remember something about ${suggestPersonName}…`
    : "Remember something from a conversation today…";
}

/**
 * The turn status narrowed to what the submit button renders. Its `resuming`
 * state (reattaching to a turn already running server-side) has no button of its
 * own and is live work, so it shows the same spinner as a freshly sent turn.
 */
function submitStatus(status: AgentStatus): ChatStatus {
  return status === "resuming" ? "submitted" : status;
}

function AssistantComposerForm({
  context,
  onStop,
  onSubmit,
  ownerUserId,
  status,
  suggestPersonName = null,
  textareaRef,
}: {
  context?: AssistantPersonContext;
  onStop: () => void;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  ownerUserId: string;
  status: AgentStatus;
  suggestPersonName?: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  // A plus-menu pick opens the Asset Evidence capture panel above the composer
  // (#201). Evidence routes through the shared capture server actions — never
  // into the turn — so chat gets no attachment model of its own. The chip inside
  // the composer is only a marker that a file is in hand; the menu stays disabled
  // while a capture is open so a second pick can't discard a half-filled form.
  const [captureFile, setCaptureFile] = useState<File | null>(null);

  return (
    <>
      <EveDraftPersistence onSubmit={onSubmit} ownerUserId={ownerUserId} status={status} />
      {captureFile ? (
        <div className="pb-3">
          <AssistantEvidenceCapture file={captureFile} onClose={() => setCaptureFile(null)} />
        </div>
      ) : null}
      <PromptInput onSubmit={onSubmit}>
        <PromptInputBody>
          {captureFile ? (
            <PromptInputHeader>
              <Attachments variant="inline">
                <Attachment
                  data={captureEvidenceChip(captureFile)}
                  onRemove={() => setCaptureFile(null)}
                >
                  <AttachmentPreview />
                  <AttachmentInfo />
                  <AttachmentRemove
                    className="[@media(hover:none)]:opacity-100"
                    label="Remove the file"
                  />
                </Attachment>
              </Attachments>
            </PromptInputHeader>
          ) : null}
          <PromptInputTextarea
            placeholder={composerPlaceholder(context, suggestPersonName)}
            ref={textareaRef}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <AssistantCaptureMenu disabled={captureFile !== null} onPick={setCaptureFile} />
            <span className="text-[length:var(--text-caption)] text-muted-foreground">
              Enter to send · Shift + Enter for a new line
            </span>
          </PromptInputTools>
          {/* Deliberately never `disabled`: InputGroup fades to 50% around any
              disabled descendant, and the textarea stays usable during a turn,
              so a dimmed composer would misread as "you can't type here". While a
              turn runs the control is Stop; Enter still sends, into the queue. */}
          <PromptInputSubmit onStop={onStop} status={submitStatus(status)} />
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}

/**
 * The picked evidence file as a composer chip. It is display only - the bytes go
 * to the Asset Evidence server actions and never into the turn (ADR 0185) - so
 * the chip carries the name and type and no URL to read the file from.
 */
function captureEvidenceChip(file: File): AttachmentData {
  return {
    filename: file.name,
    id: `evidence:${file.name}`,
    mediaType: file.type || "application/octet-stream",
    type: "file",
    url: "",
  };
}

function EveDraftPersistence({
  onSubmit,
  ownerUserId,
  status,
}: {
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  ownerUserId: string;
  status: AgentStatus;
}) {
  const controller = usePromptInputController();
  const [hydratedOwner, setHydratedOwner] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const autoSubmitting = useRef(false);
  const loadedOwner = useRef<string | null>(null);

  // fallow-ignore-next-line complexity -- Owner hydration atomically loads, consumes the one-shot handoff, and always closes the hydration gate.
  useEffect(() => {
    if (loadedOwner.current === ownerUserId) return;
    loadedOwner.current = ownerUserId;
    try {
      const draft = loadLocalComposerDraft(window.localStorage, ownerUserId, "eve");
      const submissionRequested = consumeLocalEveDraftSubmission(window.localStorage, ownerUserId);
      if (draft.restored && !controller.textInput.value) {
        controller.textInput.setInput(draft.value);
        setRestored(true);
        if (submissionRequested) {
          setPendingSubmission(draft.value);
        }
      }
    } finally {
      setHydratedOwner(ownerUserId);
    }
  }, [controller.textInput, ownerUserId]);

  // The handed-off draft leaves the input - and, through the mirror effect
  // below, local storage - the instant it is sent, on the same optimistic
  // contract as a typed submission: only a rejected send puts it back. Waiting
  // for the turn to finish would leave a sent message sitting in the composer
  // under a "Discard draft" affordance for the whole stream.
  useEffect(() => {
    if (!pendingSubmission || status !== "ready" || autoSubmitting.current) return;
    autoSubmitting.current = true;
    controller.textInput.clear();
    void onSubmit({ files: [], text: pendingSubmission })
      .catch(() => controller.textInput.restore(pendingSubmission))
      .finally(() => {
        setPendingSubmission(null);
        autoSubmitting.current = false;
      });
  }, [controller.textInput, onSubmit, pendingSubmission, status]);

  // The mirror tracks the composer, and the composer only ever holds *unsent*
  // text: a submission empties it optimistically, which lands here as an empty
  // value and clears the stored draft in the same commit. That is what keeps the
  // discard affordance below off an in-flight message - a draft is something the
  // user has not sent yet, never something the assistant is already answering. A
  // rejected send restores the input, and this effect writes the draft back with it.
  useEffect(() => {
    if (hydratedOwner !== ownerUserId) return;
    try {
      saveLocalComposerDraft(window.localStorage, ownerUserId, "eve", controller.textInput.value);
    } catch {
      // A blocked local store never changes the assistant's network-required behavior.
    }
    if (!controller.textInput.value) setRestored(false);
  }, [controller.textInput.value, hydratedOwner, ownerUserId]);

  if (!controller.textInput.value) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
      {restored ? (
        <p className="text-muted-foreground text-xs" role="status">
          Unsaved draft restored on this device.
        </p>
      ) : (
        <span />
      )}
      <button
        className="min-h-11 text-muted-foreground text-xs underline-offset-4 hover:underline"
        onClick={controller.textInput.clear}
        type="button"
      >
        Discard draft
      </button>
    </div>
  );
}
