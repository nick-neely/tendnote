"use client";

import type { PromptNudge } from "@tendnote/domain";
import { type EveMessage, useEveAgent } from "eve/react";
import { useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { AssistantCaptureMenu } from "@/components/assistant-capture-menu";
import { AssistantDebugTrace } from "@/components/assistant-debug-trace";
import { AssistantEvidenceCapture } from "@/components/assistant-evidence-capture";
import { sendNudgeToAgent } from "@/components/assistant-nudge";
import {
  AssistantComposerShell,
  AssistantEmptyCapture,
  AssistantPanelHeader,
  AssistantPanelShell,
  AssistantPrivateChip,
  assistantChipClass,
  assistantSubtitleFor,
} from "@/components/assistant-panel-chrome";
import { AssistantPromptNudges } from "@/components/assistant-prompt-nudges";
import { AssistantTurnUnitView, turnUnitKey } from "@/components/assistant-turn-unit";
import { BugIcon } from "@/components/icons";
import { Shimmer } from "@/components/ui/shimmer";
import { Toggle } from "@/components/ui/toggle";
import {
  groupTurnToolEntries,
  isTurnInFlight,
  messageActiveToolViews,
  messageText,
  messageTextSegments,
  messageToolViews,
} from "@/lib/eve/message-views";
import {
  consumeLocalEveDraftSubmission,
  loadLocalComposerDraft,
  saveLocalComposerDraft,
} from "@/lib/local-composer-draft";
import { cn } from "@/lib/utils";

export type AssistantPersonContext = {
  personId: string;
  personName: string;
};

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

/** Owner-safe one-turn client context for the agent, or none when unscoped. */
function clientContextFor(context?: AssistantPersonContext) {
  return context
    ? { person: { id: context.personId, displayName: context.personName } }
    : undefined;
}

export function AssistantPanel({
  context,
  ownerUserId,
  nudges = [],
  suggestPersonName = null,
}: {
  context?: AssistantPersonContext;
  ownerUserId: string;
  /** Calendar-derived prompt nudges; clicking one sends its text to Eve (#114). */
  nudges?: PromptNudge[];
  /**
   * A real person from the owner's notebook, used only to make the unscoped
   * composer placeholder concrete. Never a fixture name — when absent the
   * placeholder stays generic rather than naming someone who doesn't exist.
   */
  suggestPersonName?: string | null;
}) {
  // A turn that fails does not reject. Eve's store catches the network or stream
  // error itself, parks it on `status: "error"`, and *resolves* `send` - so the
  // composer's restore-on-rejection contract would never fire and the message
  // would be gone with nothing to show for it. `onError` is the store's only
  // signal that the turn it just settled actually failed; we hold the failure
  // here so `handleSubmit` can rethrow it and put the text back.
  const turnFailure = useRef<Error | null>(null);

  // Stream turns directly from the same-origin Eve mount (withEve). The hook owns
  // the durable Eve session, so follow-up turns continue the same conversation
  // without a Tendnote chat transcript (ADR 0030). Durable product state still
  // lives in source records, memories, and follow-ups (ADR 0029).
  const agent = useEveAgent({
    onError: (error) => {
      turnFailure.current = error;
    },
  });

  // Toggles the Eve turn trace surface (see assistant-debug-trace.tsx) — a
  // developer diagnostic for tool calls and the raw stream, off by default.
  const [showDebug, setShowDebug] = useState(false);

  const messages = agent.data.messages;

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();

    if (!text) {
      return;
    }

    // The composer clears optimistically the moment it hands a message off, and
    // only a rejection puts the text back. So a refusal has to reject: resolving
    // here would silently eat the user's words. Eve's own store throws the same
    // way when a turn is already in flight - and only then. `error` is the last
    // turn's verdict, not a busy signal, so refusing on it would wedge the
    // composer after one failure with no way to retry.
    if (isTurnInFlight(agent.status)) {
      throw new Error("Eve is still finishing the previous turn.");
    }

    // A failure belongs to the turn that produced it. Clearing it as this send
    // starts is what keeps a stale verdict from rejecting the next message; the
    // store retires its own `error` at the same moment.
    turnFailure.current = null;

    await agent.send(text, { clientContext: clientContextFor(context) });

    // `send` resolved, which says nothing about whether the turn worked. If it
    // failed, `onError` already ran - the store calls it before settling - so
    // anything parked here is this submission's failure, not an older one.
    const failure = turnFailure.current;
    if (failure) {
      turnFailure.current = null;
      throw failure;
    }
  }

  // A prompt nudge starts a conversational turn by sending its text to Eve — it
  // never mutates product state or accepts/dismisses a suggestion (#114).
  function sendNudge(prompt: string) {
    sendNudgeToAgent({ status: agent.status, send: agent.send }, context, prompt);
  }

  return (
    <AssistantPanelShell id="assistant">
      <AssistantHeader
        context={context}
        onToggleDebug={() => setShowDebug((on) => !on)}
        showDebug={showDebug}
      />

      {/* The leading flex-1 spacer (in AssistantConversation) anchors a short
          conversation to the bottom; it collapses once messages overflow so the
          transcript scrolls normally. Do NOT use `justify-end` here — with
          overflow it traps the top of the transcript out of scroll range. */}
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="min-h-full gap-4 p-4 sm:p-5">
          <AssistantConversation messages={messages} status={agent.status} />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Eve turn trace; toggled from the header. */}
      {showDebug ? (
        <div className="max-h-80 overflow-auto">
          <AssistantDebugTrace
            error={agent.error}
            events={agent.events}
            messages={messages}
            status={agent.status}
          />
        </div>
      ) : null}

      {/* Calendar prompt nudges sit just above the composer on the idle assistant,
          so they invite a conversation without crowding an active transcript (#114). */}
      {messages.length === 0 ? (
        <div className="px-4 pt-2 sm:px-5">
          <AssistantPromptNudges
            disabled={agent.status !== "ready"}
            nudges={nudges}
            onSelect={sendNudge}
          />
        </div>
      ) : null}

      <AssistantComposer
        context={context}
        onSubmit={handleSubmit}
        ownerUserId={ownerUserId}
        status={agent.status}
        suggestPersonName={suggestPersonName}
      />
    </AssistantPanelShell>
  );
}

function AssistantHeader({
  context,
  showDebug,
  onToggleDebug,
}: {
  context?: AssistantPersonContext;
  showDebug: boolean;
  onToggleDebug: () => void;
}) {
  return (
    <AssistantPanelHeader
      actions={
        <>
          {/* Developer trace toggle for the Eve turn (tool calls + raw stream).
              Both `aria-pressed:` and `data-[state=on]:` are spelled out so the
              pressed fill beats the Toggle base's own rule for each - they land
              at equal specificity, so leaving either to source order is a coin
              flip. */}
          <Toggle
            aria-label="Toggle debug trace"
            className={cn(
              assistantChipClass,
              "h-auto min-w-0 bg-secondary text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
              "aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:bg-foreground data-[state=on]:text-background",
              "data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background",
            )}
            onPressedChange={onToggleDebug}
            pressed={showDebug}
          >
            <BugIcon aria-hidden className="size-3" />
            Debug
          </Toggle>
          <AssistantPrivateChip />
        </>
      }
      subtitle={assistantSubtitleFor(context?.personName)}
    />
  );
}

/** The live conversation, or the empty state before a first turn exists. */
function AssistantConversation({
  messages,
  status,
}: {
  messages: readonly EveMessage[];
  status: AgentStatus;
}) {
  // The empty state means "nothing has happened yet" - so it yields as soon as
  // anything has, including a turn that failed before producing a message. An
  // error the panel silently replaced with "Start your notebook" would be the
  // worst of both: no answer and no explanation.
  if (messages.length === 0 && status === "ready") {
    return <AssistantEmptyCapture />;
  }

  // Only the last message can be the one Eve is still writing, so it is the only
  // one allowed to show working lines - and only while the turn is live. Every
  // earlier turn is finished history, however its tool parts happened to end.
  const liveIndex = isTurnInFlight(status) ? messages.length - 1 : -1;

  return (
    <>
      <div aria-hidden className="min-h-0 flex-1" />
      {messages.map((message, index) => (
        <MessageTurn key={message.id} live={index === liveIndex} message={message} />
      ))}
      <TurnStatus status={status} />
    </>
  );
}

/** One conversation turn: the user prompt, or assistant text plus tool activity. */
function MessageTurn({ live, message }: { live: boolean; message: EveMessage }) {
  if (message.role === "user") {
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
      <Message from="user">
        <MessageContent
          className={cn(
            notSent &&
              "group-[.is-user]:border group-[.is-user]:border-border group-[.is-user]:border-dashed group-[.is-user]:bg-transparent group-[.is-user]:text-muted-foreground",
          )}
        >
          {messageText(message)}
        </MessageContent>
        {notSent ? (
          <span className="ml-auto text-[length:var(--text-caption)] text-muted-foreground">
            Not sent
          </span>
        ) : null}
      </Message>
    );
  }

  // Each agent step contributes its own text part, so a turn that stops to run
  // tools says several separate things. Render them as separate blocks - running
  // them into one string is what produced "…about Jordan Rivera.Found them!".
  const segments = messageTextSegments(message);
  // Fold runs of same-kind durable saves into one collapsed group so a busy
  // capture turn ("added a person, then saved six things about them") reads as a
  // short summary by default; interactive review cards and lookups stay in place.
  const units = groupTurnToolEntries(messageToolViews(message));
  const active = messageActiveToolViews(message, live);

  return (
    <div className="flex flex-col gap-2.5">
      {segments.length > 0 ? (
        <Message from="assistant">
          {/* gap-3 matches the paragraph rhythm inside a segment, so one long
              answer and several short ones breathe the same way. */}
          <MessageContent className="gap-3">
            {segments.map((segment) => (
              <MessageResponse key={segment.key}>{segment.text}</MessageResponse>
            ))}
          </MessageContent>
        </Message>
      ) : null}
      {units.map((unit) => (
        <AssistantTurnUnitView key={turnUnitKey(message.id, unit)} unit={unit} />
      ))}
      {active.map((tool) => (
        <WorkingLine key={`${message.id}:${tool.toolCallId}`} label={tool.label} />
      ))}
    </div>
  );
}

/** Transient shimmer line for an in-flight tool call or the pre-token wait. */
function WorkingLine({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
      <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
      <Shimmer>{label}</Shimmer>
    </p>
  );
}

/**
 * Defers a transient flag so it only shows after `delay` and, once shown, stays
 * for at least `minVisible`. Eve often answers in under a beat; without this the
 * "Thinking…" shimmer flickers on and off in a blink. A fast turn never trips
 * `delay`, so the shimmer simply never appears; a slower one shows steadily.
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
        Eve is unavailable. Your records are safe, and your question wasn't saved. Try again in a
        moment.
      </p>
    );
  }

  return thinking ? <WorkingLine label="Thinking…" /> : null;
}

function AssistantComposer({
  context,
  ownerUserId,
  status,
  onSubmit,
  suggestPersonName = null,
}: {
  context?: AssistantPersonContext;
  ownerUserId: string;
  status: AgentStatus;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  suggestPersonName?: string | null;
}) {
  // A plus-menu pick opens the Asset Evidence capture panel above the composer
  // (#201). Evidence routes through the shared capture server actions — never
  // into the Eve turn — so chat gets no attachment model of its own. The menu
  // stays disabled while a capture is open so a second pick can't discard a
  // half-filled form.
  return (
    <PromptInputProvider key={ownerUserId}>
      <AssistantComposerForm
        context={context}
        onSubmit={onSubmit}
        ownerUserId={ownerUserId}
        status={status}
        suggestPersonName={suggestPersonName}
      />
    </PromptInputProvider>
  );
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

function AssistantComposerForm({
  context,
  ownerUserId,
  status,
  onSubmit,
  suggestPersonName = null,
}: {
  context?: AssistantPersonContext;
  ownerUserId: string;
  status: AgentStatus;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  suggestPersonName?: string | null;
}) {
  const [captureFile, setCaptureFile] = useState<File | null>(null);

  return (
    <AssistantComposerShell>
      <EveDraftPersistence onSubmit={onSubmit} ownerUserId={ownerUserId} status={status} />
      {captureFile ? (
        <div className="pb-3">
          <AssistantEvidenceCapture file={captureFile} onClose={() => setCaptureFile(null)} />
        </div>
      ) : null}
      <PromptInput onSubmit={onSubmit}>
        <PromptInputBody>
          <PromptInputTextarea placeholder={composerPlaceholder(context, suggestPersonName)} />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <AssistantCaptureMenu disabled={captureFile !== null} onPick={setCaptureFile} />
            <span className="text-[length:var(--text-caption)] text-muted-foreground">
              Enter to save · Shift + Enter for a new line
            </span>
          </PromptInputTools>
          {/* Deliberately never `disabled`: InputGroup fades to 50% around any
              disabled descendant, and the textarea stays usable during a turn,
              so a dimmed composer would misread as "you can't type here". A send
              Eve can't take is refused by handleSubmit, which restores the text. */}
          <PromptInputSubmit status={status} />
        </PromptInputFooter>
      </PromptInput>
    </AssistantComposerShell>
  );
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
  // under a "Discard Eve draft" affordance for the whole stream.
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
  // user has not sent yet, never something Eve is already answering. A rejected
  // send restores the input, and this effect writes the draft back with it.
  useEffect(() => {
    if (hydratedOwner !== ownerUserId) return;
    try {
      saveLocalComposerDraft(window.localStorage, ownerUserId, "eve", controller.textInput.value);
    } catch {
      // A blocked local store never changes Eve's network-required behavior.
    }
    if (!controller.textInput.value) setRestored(false);
  }, [controller.textInput.value, hydratedOwner, ownerUserId]);

  if (!controller.textInput.value) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
      {restored ? (
        <p className="text-muted-foreground text-xs" role="status">
          Unsaved Eve draft restored on this device.
        </p>
      ) : (
        <span />
      )}
      <button
        className="min-h-11 text-muted-foreground text-xs underline-offset-4 hover:underline"
        onClick={controller.textInput.clear}
        type="button"
      >
        Discard Eve draft
      </button>
    </div>
  );
}
