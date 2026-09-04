"use client";

import type { PromptNudge } from "@tendnote/domain";
import type { ChatStatus } from "ai";
import type { EveMessage } from "eve/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordSessionToolTrustAction } from "@/app/actions/eve-approvals";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  type PromptInputMessage,
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Suggestion } from "@/components/ai-elements/suggestion";
import {
  AssistantApprovalPolicyProvider,
  type EveApprovalMode,
} from "@/components/assistant-approval-policy-context";
import { AssistantAuthorizationCard } from "@/components/assistant-authorization-card";
import { AssistantComposerForm } from "@/components/assistant-composer";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { sendNudgeToAgent } from "@/components/assistant-nudge";
import {
  AssistantComposerShell,
  AssistantEmptyCapture,
  AssistantEndedNotice,
  AssistantPageGreeting,
  AssistantPanelHeader,
  AssistantPanelShell,
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
import { DropOverlay } from "@/components/drop-overlay";
import { ArrowUpRightIcon } from "@/components/icons";
import {
  type RecordSessionToolTrust,
  SessionToolTrustProvider,
} from "@/components/session-tool-trust-context";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/shimmer";
import { ASSISTANT_CONVERSATION_STARTERS } from "@/lib/assistant/starters";
import {
  APPROVE_OPTION_ID,
  pendingApprovalRequests,
  typedApprovalAnswer,
} from "@/lib/eve/approval-answers";
import { webTaintedToolCallIds } from "@/lib/eve/conversation-taint";
import { EVIDENCE_DROP_ACCEPT, type EvidencePick, useEvidencePick } from "@/lib/eve/evidence-pick";
import { followUpSuggestions } from "@/lib/eve/follow-up-suggestions";
import type { AssistantInputRequestView } from "@/lib/eve/input-request-view";
import {
  isTurnInFlight,
  messageFiles,
  messageProposedFollowUps,
  messageText,
  messageTextSegments,
  messageToolViews,
  messageTurnAnatomy,
} from "@/lib/eve/message-views";
import type { SelectedPersonContext } from "@/lib/eve/selected-person-context";
import { turnSources } from "@/lib/eve/sources";
import { turnTiming } from "@/lib/eve/turn-timing";
import { turnUnitKey } from "@/lib/eve/turn-unit-key";
import {
  type AssistantAgentStatus,
  type AssistantResumeSettled,
  type SendPrompt,
  useAssistantSession,
  useResumedSession,
} from "@/lib/eve/use-assistant-session";
import { type AssistantSendQueueControls, useSendQueue } from "@/lib/eve/use-send-queue";
import { useFileDropZone } from "@/lib/use-file-drop-zone";
import { cn } from "@/lib/utils";

type AssistantPersonContext = SelectedPersonContext;

type AgentStatus = AssistantAgentStatus;

/**
 * The transcript region's padding, by where the panel is standing. A lookup
 * rather than three `&&`s inside one `cn`, so adding a surface is a row here.
 */
const TRANSCRIPT_PADDING: Record<AssistantSurface, string> = {
  // The phone's flow owns its gutter; the page column owns its own, so the
  // scroller there only opens the distance to the header and the composer.
  bleed: "px-gutter py-4",
  page: "py-6",
  panel: "p-4 sm:p-5",
};

type AssistantPanelProps = {
  /**
   * The owner's Approval Mode, for the one thing the browser does with it: explain
   * why a card appeared in a conversation where web content was read. The agent's
   * policy reads the mode from the database on every gated call, so nothing here is
   * authoritative and a stale value can only produce a stale sentence.
   *
   * Defaults to the cautious mode, which is also the mode that says nothing extra.
   */
  approvalMode?: EveApprovalMode;
  context?: AssistantPersonContext;
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
};

/**
 * The conversation surface, once it knows which conversation it is standing in.
 *
 * A reopened thread's durable stream is read *before* the session opens, because
 * `useEveAgent` reads its configuration once and the difference between "follow
 * this stream" and "this stream is finished" is the difference between a usable
 * composer and a fifteen-second wait (see `use-assistant-session.ts`). The read
 * takes about a third of a second and runs behind the same turn-shaped geometry
 * the transcript would have shown anyway, so nothing is spent on it.
 */
export function AssistantPanel(props: AssistantPanelProps) {
  const resumed = useResumedSession(props.initialSessionId);

  if (resumed.kind === "pending") {
    return <AssistantPanelReserve context={props.context} surface={props.surface ?? "panel"} />;
  }

  return <AssistantConversationPanel {...props} resumed={resumed} />;
}

/**
 * A reopened thread in the moment before its stream has been read: the panel's
 * real chrome around turn-shaped geometry, so the transcript lands into a column
 * that is already the right shape (DESIGN.md §Loading). The composer is a well
 * rather than a box, because one that cannot yet take a message is worse than
 * one that is plainly not ready.
 */
function AssistantPanelReserve({
  context,
  surface,
}: {
  context?: AssistantPersonContext;
  surface: AssistantSurface;
}) {
  return (
    <AssistantPanelShell
      aria-busy="true"
      aria-label="Loading the conversation"
      id="assistant"
      surface={surface}
    >
      <AssistantHeader context={context} surface={surface} />
      <div className={cn("min-h-0 flex-1 overflow-hidden", TRANSCRIPT_PADDING[surface])}>
        <AssistantResumeSkeleton />
      </div>
      <AssistantComposerShell surface={surface}>
        {/* The live composer's own well: a `min-h-16` textarea above a 46px
            control row inside a 1px border, 7rem in total. */}
        <div aria-hidden className="min-h-28 w-full rounded-lg border border-input" />
      </AssistantComposerShell>
    </AssistantPanelShell>
  );
}

function AssistantConversationPanel({
  approvalMode = "ask",
  context,
  onSessionStarted,
  ownerUserId,
  nudges = [],
  resumed,
  suggestPersonName = null,
  surface = "panel",
}: AssistantPanelProps & { resumed: AssistantResumeSettled }) {
  // One Eve session, and the only honest way to send into it: `deliver` rethrows
  // the failure eve announces out of band, and `ended` is the one failure the
  // reader must never be invited to retry (see `useAssistantSession`).
  const { agent, deliver, ended } = useAssistantSession({
    context,
    onSessionStarted,
    resumed,
  });

  // Messages typed while a turn was running. Eve has no queue of its own, so this
  // is the app's - it owns the drain, the ordering, and the steer.
  const queue = useSendQueue({ deliver, ownerUserId, status: agent.status });

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messages = agent.data.messages;

  // Every tool approval still waiting on the owner, oldest first. Two things read
  // it: the composer, which must not send the word "approve" as a message, and the
  // line under the box that says what sending one would do.
  const pendingApprovals = useMemo(() => pendingApprovalRequests(messages), [messages]);

  /**
   * A typed answer to the oldest waiting approval, if that is what this line is.
   *
   * The framework's own instruction to the model is never to ask anyone to type
   * "approve", but people type it anyway - and eve clears the parked batch when an
   * ordinary message arrives, so the word meant to allow the save is exactly what
   * cancels it. So the composer answers with it instead, and only on an exact match
   * against an option the request itself offers.
   *
   * Rejecting rather than swallowing a failure is deliberate: the composer restores
   * the text it optimistically cleared on a rejection, so a refused response leaves
   * the owner's word back in the box rather than nowhere.
   */
  const answerTypedApproval = useCallback(
    async (text: string): Promise<boolean> => {
      const oldest = pendingApprovals[0];
      const optionId = oldest ? typedApprovalAnswer(oldest, text) : null;
      if (!oldest || !optionId) {
        return false;
      }
      await agent.respond([{ requestId: oldest.requestId, optionId }]);
      return true;
    },
    [agent.respond, pendingApprovals],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (await answerTypedApproval(message.text)) {
        return;
      }
      await queue.submit(message.text);
    },
    [answerTypedApproval, queue.submit],
  );

  // Which parked calls the transcript already read web content before. Explanatory
  // only: the agent derives the same fact authoritatively, and the card uses this to
  // decide whether to say a sentence, never what to send.
  const taintedCallIds = useMemo(() => webTaintedToolCallIds(messages), [messages]);
  const isTaintedBefore = useCallback(
    (toolCallId: string) => taintedCallIds.has(toolCallId),
    [taintedCallIds],
  );

  /**
   * Where a ticked "don't ask again" goes: the owner-scoped action, which writes
   * only through the session-owner binding.
   *
   * Best effort by construction. It runs after an approval that already went
   * through, so a rejected promise or a `recorded: false` costs a convenience and
   * never a decision - and `false` is the same answer for a session that belongs
   * to somebody else as for one that never existed (ADR 0219), so there is
   * nothing here to tell the owner either way.
   */
  const recordSessionToolTrust = useCallback<RecordSessionToolTrust>(async (request) => {
    await recordSessionToolTrustAction(request).catch(() => {});
  }, []);

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

  // Reattaching to a turn that is still running server-side, with nothing of it
  // on screen yet. It says nothing about the *transcript*, which the pre-read
  // already seeded: only a thread with no replayed messages at all is still
  // waiting for its history, and only that one holds turn-shaped geometry rather
  // than the conversation. `undefined` rather than `false`, because
  // `aria-busy="false"` is a claim of its own.
  const resuming = agent.status === "resuming";
  const replaying = (resuming && messages.length === 0) || undefined;

  // A page-scale conversation with nothing in it yet: the greeting and composer
  // rise together to the middle of the column, and settle to the bottom on the
  // first message. Only `page` does this — the dashboard column and the phone
  // sheet are both too short for the move to read as anything but a jump.
  const centeredComposer =
    surface === "page" && !resuming && messages.length === 0 && agent.status === "ready";

  // The whole conversation surface is a drop target, not just the composer box:
  // a file dragged over the transcript is aimed at this panel, and a target the
  // size of one input is a target the user has to find. The drop lands in the
  // same evidence capture the "+" menu opens (ADR 0185) — the state lives here
  // because the target and the composer are two different elements. An ended
  // thread has no composer at all, and so nowhere to render a capture: it takes
  // no drops, exactly as it offers no "+" menu.
  const surfaceRef = useRef<HTMLElement>(null);
  const evidence = useEvidencePick();
  const dragging = useFileDropZone(surfaceRef, {
    accept: EVIDENCE_DROP_ACCEPT,
    enabled: !ended,
    onFiles: evidence.takeDrop,
  });

  return (
    <PromptInputProvider key={ownerUserId}>
      <AssistantPanelShell className="relative" id="assistant" ref={surfaceRef} surface={surface}>
        <AssistantHeader context={context} sessionId={agent.session?.sessionId} surface={surface} />

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
          {/* Why a card is asking, and where a "don't ask again" goes. Both are
              conversation-wide facts the cards are several layers below, and neither
              can change what a card sends. */}
          <AssistantApprovalPolicyProvider
            approvalMode={approvalMode}
            isTaintedBefore={isTaintedBefore}
          >
            <SessionToolTrustProvider
              recordSessionToolTrust={recordSessionToolTrust}
              sessionId={agent.session?.sessionId ?? null}
            >
              <Conversation aria-busy={replaying} className="min-h-0 flex-1">
                <ConversationContent
                  className={cn("min-h-full gap-4", TRANSCRIPT_PADDING[surface])}
                >
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
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            </SessionToolTrustProvider>
          </AssistantApprovalPolicyProvider>
        </AssistantRespondProvider>

        <AssistantComposerRegion
          centered={centeredComposer}
          context={context}
          ended={ended}
          evidence={evidence}
          nudges={nudges}
          onStop={() => void agent.cancel()}
          onSend={sendPrompt}
          onSendNudge={sendNudge}
          onSubmit={handleSubmit}
          ownerUserId={ownerUserId}
          pendingApproval={pendingApprovals[0] ?? null}
          queue={queue}
          status={submitStatus(agent.status)}
          suggestPersonName={suggestPersonName}
          surface={surface}
          textareaRef={composerRef}
        />

        <AssistantSettleSpacer grow={centeredComposer} surface={surface} />

        {dragging ? (
          <DropOverlay
            hint="Kept as evidence for your review, never read by the assistant."
            title="Drop to attach"
          />
        ) : null}
      </AssistantPanelShell>
    </PromptInputProvider>
  );
}

/**
 * The one authored move on this page. The greeting and composer sit between the
 * transcript region and this spacer, both growing; taking the spacer's growth
 * away on the first message slides them down to the bottom of the column instead
 * of teleporting them there. Reduced motion keeps the same two positions and
 * drops the travel.
 */
function AssistantSettleSpacer({ grow, surface }: { grow: boolean; surface: AssistantSurface }) {
  if (surface !== "page") {
    return null;
  }

  return (
    <div
      aria-hidden
      className="shrink-0 basis-0 transition-[flex-grow] duration-200 ease-(--motion-ease-out) motion-reduce:transition-none"
      style={{ flexGrow: grow ? 1 : 0 }}
    />
  );
}

/**
 * Everything below the transcript: what is still queued, the box itself, and —
 * before a first turn exists — the greeting and starters that ride with it.
 *
 * The greeting is here rather than at the foot of the transcript because this is
 * the group the page centres. The queue is *outside* the ended branch for the
 * opposite reason: a composer that cannot send is worse than no composer (Eve's
 * session lifetime is absolute, and a follow-up to an expired one is refused at
 * the door — ADR 0238), but words the ending overtook were never sent, and
 * taking them off screen along with the box would quietly delete them.
 */
function AssistantComposerRegion({
  centered,
  context,
  ended,
  evidence,
  nudges,
  onSend,
  onSendNudge,
  onStop,
  onSubmit,
  ownerUserId,
  pendingApproval,
  queue,
  status,
  suggestPersonName,
  surface,
  textareaRef,
}: {
  centered: boolean;
  context?: AssistantPersonContext;
  ended: boolean;
  evidence: EvidencePick;
  nudges: PromptNudge[];
  onSend: SendPrompt;
  onSendNudge: (prompt: string) => void;
  onStop: () => void;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  ownerUserId: string;
  /** The oldest tool approval still waiting on the owner, or null. */
  pendingApproval: AssistantInputRequestView | null;
  queue: AssistantSendQueueControls;
  status: ChatStatus;
  suggestPersonName: string | null;
  surface: AssistantSurface;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  // On an ended thread the strip is a record rather than a queue: nothing can be
  // sent, so Send now goes and the list says why it is still here.
  const queueNote = ended ? "These weren't sent." : undefined;
  const onSendNow = ended ? null : queue.sendNow;

  return (
    <>
      {centered ? <AssistantPageGreeting /> : null}
      <AssistantComposerShell surface={surface}>
        <PendingApprovalNote request={ended ? null : pendingApproval} />
        <AssistantSendQueue
          items={queue.items}
          note={queueNote}
          onRemove={queue.remove}
          onSendNow={onSendNow}
        />
        {ended ? (
          <AssistantEndedNotice>
            <Button asChild className="shrink-0" size="sm">
              <Link href="/assistant">Start a new conversation</Link>
            </Button>
          </AssistantEndedNotice>
        ) : (
          <AssistantLiveComposer
            centered={centered}
            context={context}
            evidence={evidence}
            nudges={nudges}
            onSend={onSend}
            onSendNudge={onSendNudge}
            onStop={onStop}
            onSubmit={onSubmit}
            ownerUserId={ownerUserId}
            status={status}
            suggestPersonName={suggestPersonName}
            textareaRef={textareaRef}
          />
        )}
      </AssistantComposerShell>
    </>
  );
}

/**
 * What pressing Enter does while a decision is waiting above.
 *
 * Usually it costs the approval: eve clears the parked batch when an ordinary
 * message arrives - that is the framework's own behaviour, not a rule this app
 * could soften - so a follow-up thought typed into the box silently withdraws it.
 * One line, stated plainly, so the owner is not surprised by it. It never blocks
 * the box: sending is a legitimate thing to do, and a composer that argued with
 * the reader would be pressing for the approval.
 *
 * The exception is the word itself. `handleSubmit` intercepts an exact `approve`
 * or `cancel` and answers the card with it instead of sending it, so on those two
 * drafts the standing line is not merely unhelpful, it is false. The note reads
 * the live draft through the composer's own controller and says what Enter will
 * actually do - the same helper the submit path uses, so the sentence and the
 * behaviour cannot disagree.
 *
 * `status` rather than `alert`: nothing is wrong, and it appears at the moment eve
 * parks the turn, which is worth hearing once without interrupting.
 */
function PendingApprovalNote({ request }: { request: AssistantInputRequestView | null }) {
  const { textInput } = usePromptInputController();

  if (request === null) {
    return null;
  }

  const optionId = typedApprovalAnswer(request, textInput.value);

  return (
    <p
      className="pb-2 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
      role="status"
    >
      {optionId === APPROVE_OPTION_ID
        ? "Enter approves the request waiting above."
        : optionId !== null
          ? "Enter cancels the request waiting above."
          : "Sending a message cancels the approval waiting above."}
    </p>
  );
}

/** The box itself, and — before a first turn — the starters that sit under it. */
function AssistantLiveComposer({
  centered,
  context,
  evidence,
  nudges,
  onSend,
  onSendNudge,
  onStop,
  onSubmit,
  ownerUserId,
  status,
  suggestPersonName,
  textareaRef,
}: {
  centered: boolean;
  context?: AssistantPersonContext;
  evidence: EvidencePick;
  nudges: PromptNudge[];
  onSend: SendPrompt;
  onSendNudge: (prompt: string) => void;
  onStop: () => void;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  ownerUserId: string;
  status: ChatStatus;
  suggestPersonName: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <>
      <AssistantComposerForm
        context={context}
        evidence={evidence}
        onStop={onStop}
        onSubmit={onSubmit}
        ownerUserId={ownerUserId}
        status={status}
        suggestPersonName={suggestPersonName}
        textareaRef={textareaRef}
      />
      {centered ? (
        <div className="pt-3">
          <AssistantConversationStarters
            nudges={nudges}
            onSend={onSend}
            onSendNudge={onSendNudge}
          />
        </div>
      ) : null}
    </>
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

/**
 * The dashboard column's own header. The other two surfaces have a header above
 * the panel already — a second one inside it would be the nested chrome
 * DESIGN.md rules out — so the surface gate lives here rather than at the call
 * site, where it was a ternary six JSX levels deep.
 */
function AssistantHeader({
  context,
  sessionId,
  surface,
}: {
  context?: AssistantPersonContext;
  /** The live thread, so "Open" lands in *this* conversation rather than a new one. */
  sessionId?: string;
  surface: AssistantSurface;
}) {
  if (surface !== "panel") {
    return null;
  }

  // One affordance, and it is the only one that does anything for the reader.
  // The "Private" chip said in a badge what the subtitle underneath it already
  // says in a sentence, and the Debug toggle was a developer's control sitting
  // permanently in the owner's header.
  return (
    <AssistantPanelHeader
      actions={
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
  // Everything the reader has already asked in this thread. A follow-up chip
  // offering a question they typed two turns ago is the conversation forgetting
  // itself, so the whole thread is what the chips are filtered against.
  const asked = useMemo(
    () => messages.filter((message) => message.role === "user").map(messageText),
    [messages],
  );

  // A thread with history that has not arrived yet gets turn-shaped geometry
  // rather than a spinner or, worse, the "nothing has happened yet" greeting
  // (DESIGN.md §Loading). Once *any* of it has arrived the transcript is the
  // better thing to look at, even while eve is still following a live turn — a
  // conversation the reader can already read is never worth hiding behind its
  // own skeleton.
  if (status === "resuming" && messages.length === 0) {
    return <AssistantResumeSkeleton />;
  }

  // The empty state means "nothing has happened yet" - so it yields as soon as
  // anything has, including a turn that failed before producing a message. An
  // error the panel silently replaced with a greeting would be the worst of both:
  // no answer and no explanation.
  if (messages.length === 0 && status === "ready") {
    // On the page the greeting, the composer, and the starters are one group that
    // the panel centres as a unit, so none of it is in here - this region is
    // simply empty, and its growth is half of what centres that group. Everywhere
    // else the whole invitation is centred inside the panel itself.
    return surface === "page" ? null : (
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

  // Whether the live turn has an assistant message yet. Once it does, that turn's
  // own activity disclosure carries the "Working…" indicator, and the standalone
  // status line below the transcript must stand down or the two would say the
  // same thing twice, one under the other (see {@link TurnStatus}).
  const liveTurn = liveIndex >= 0 && messages[liveIndex]?.role === "assistant";

  return (
    <>
      <div aria-hidden className="min-h-0 flex-1" />
      {messages.map((message, index) => (
        <MessageTurn
          asked={asked}
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
      <TurnStatus liveTurn={liveTurn} status={status} />
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
  asked,
  busy,
  composerRef,
  events,
  live,
  message,
  onSend,
  showFollowUps,
  userPrompt,
}: {
  asked: readonly string[];
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
      asked={asked}
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

  // eve resolves a `url` only for files carried by a message of the owner's own,
  // so this is where an attachment can actually be rendered rather than claimed.
  const files = messageFiles(message);

  return (
    <div className="group/turn flex flex-col gap-1">
      <AssistantTurnFiles files={files} />
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
  asked,
  busy,
  events,
  live,
  message,
  onSend,
  showFollowUps,
  userPrompt,
}: {
  asked: readonly string[];
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
  // The model's own proposals win where it made any, because it read the answer
  // it just wrote; the kind-derived list is the fallback for the turns where it
  // said nothing (see `follow-up-suggestions.ts`).
  const suggestions = useMemo(
    () =>
      showFollowUps
        ? followUpSuggestions({
            asked,
            proposed: messageProposedFollowUps(message),
            views: messageToolViews(message).map((it) => it.view),
          })
        : [],
    [asked, message, showFollowUps],
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
              // The pages the turn actually read, so a link to one of them
              // renders as a numbered citation rather than a bare link. The
              // reasoning body deliberately gets none: a citation number in an
              // aside would compete with the answer's own numbering.
              <AssistantMarkdown key={segment.key} sources={sources}>
                {segment.text}
              </AssistantMarkdown>
            ))}
          </MessageContent>
        </Message>
      ) : null}
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
      {/* Wrapped rather than in the `Suggestions` scroller, for the reason the
          starters give: its scrollbar is hidden, so at 390px the second chip is
          cut at the column edge with nothing to say it scrolls. Three chips wrap
          cleanly. */}
      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion}
              onClick={(text) => void onSend(text)}
              suggestion={suggestion}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The turn's indicator before it has a message of its own to hang it on.
 *
 * Deliberately identical to the activity disclosure's trigger — the same sage
 * dot, the same `Shimmer`, the same word — because the two are one continuous
 * indicator handing off to each other, and any difference between them would
 * read as two things happening rather than one thing continuing.
 */
function WorkingLine() {
  return (
    <p className="flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
      />
      <Shimmer>Working…</Shimmer>
    </p>
  );
}

/**
 * Defers a transient flag so it only shows after `delay` and, once shown, stays
 * for at least `minVisible`. The assistant often answers in under a beat; without
 * `delay` the "Working…" shimmer flickers on and off in a blink. A fast turn never
 * trips it, so the shimmer simply never appears; a slower one shows steadily.
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

/**
 * Live turn status: the working indicator while a turn spins up, or a reach error.
 *
 * This line and the live turn's activity disclosure are two halves of *one*
 * indicator, and the whole point is that the reader never sees a seam between
 * them. It covers the stretch before the assistant message exists; the disclosure
 * covers everything after, from the same position, with the same dot and the same
 * word. So `liveTurn` retires this line the instant the disclosure can take over,
 * and `minVisible: 0` is what makes that instant: the anti-flicker floor exists to
 * stop a shimmer blinking in and out, and with a successor already on screen it
 * could only ever produce half a second of the same line twice over. The flash it
 * guarded against is still covered by `delay`, which nothing under 350ms trips.
 *
 * `liveTurn` is then read a second time at the return, which is not redundant:
 * the deferred flag can only ever retire this line an effect later, and one frame
 * of both saying "Working…" one under the other is the one failure the hand-off
 * has left. Reading it in the render makes the two impossible to co-exist, since
 * the same commit that first renders the disclosure is the one that drops this.
 */
function TurnStatus({ liveTurn, status }: { liveTurn: boolean; status: AgentStatus }) {
  const working = useDeferredFlag(isTurnInFlight(status) && !liveTurn, {
    delay: 350,
    minVisible: 0,
  });

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

  return working && !liveTurn ? <WorkingLine /> : null;
}

/**
 * The turn status narrowed to what the submit button renders. Its `resuming`
 * state (reattaching to a turn already running server-side) has no button of its
 * own and is live work, so it shows the same spinner as a freshly sent turn.
 */
function submitStatus(status: AgentStatus): ChatStatus {
  return status === "resuming" ? "submitted" : status;
}
