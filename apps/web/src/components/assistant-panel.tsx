"use client";

import type { PromptNudge } from "@tendnote/domain";
import { type EveMessage, useEveAgent } from "eve/react";
import { BugIcon, LockIcon, NotebookPenIcon } from "lucide-react";
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
import { AssistantPromptNudges } from "@/components/assistant-prompt-nudges";
import { AssistantTurnUnitView, turnUnitKey } from "@/components/assistant-turn-unit";
import { Shimmer } from "@/components/ui/shimmer";
import {
  groupTurnToolEntries,
  messageActiveToolViews,
  messageText,
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
  // Stream turns directly from the same-origin Eve mount (withEve). The hook owns
  // the durable Eve session, so follow-up turns continue the same conversation
  // without a Tendnote chat transcript (ADR 0030). Durable product state still
  // lives in source records, memories, and follow-ups (ADR 0029).
  const agent = useEveAgent();

  // Toggles the Eve turn trace surface (see assistant-debug-trace.tsx) — a
  // developer diagnostic for tool calls and the raw stream, off by default.
  const [showDebug, setShowDebug] = useState(false);

  const messages = agent.data.messages;

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();

    if (!text || agent.status !== "ready") {
      return;
    }

    await agent.send({ message: text, clientContext: clientContextFor(context) });
  }

  // A prompt nudge starts a conversational turn by sending its text to Eve — it
  // never mutates product state or accepts/dismisses a suggestion (#114).
  function sendNudge(prompt: string) {
    sendNudgeToAgent({ status: agent.status, send: agent.send }, context, prompt);
  }

  return (
    <section
      className="flex h-full min-h-[30rem] flex-col rounded-xl border bg-panel lg:min-h-0"
      id="assistant"
    >
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
    </section>
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
  const subtitle = context
    ? `Capturing about ${context.personName}. Saved and linked to them before review.`
    : "Jot anything you want to remember. Saved privately, reviewed before it becomes memory.";

  return (
    <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-sm font-semibold">Assistant</h2>
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {subtitle}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Developer trace toggle for the Eve turn (tool calls + raw stream). */}
        <button
          aria-label="Toggle debug trace"
          aria-pressed={showDebug}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-[length:var(--text-caption)] transition-colors",
            showDebug
              ? "bg-foreground text-background"
              : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
          onClick={onToggleDebug}
          type="button"
        >
          <BugIcon aria-hidden className="size-3" />
          Debug
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-[length:var(--text-caption)] text-muted-foreground">
          <LockIcon aria-hidden className="size-3" />
          Private
        </span>
      </div>
    </header>
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
  if (messages.length === 0 && status !== "submitted") {
    return <EmptyCapture />;
  }

  return (
    <>
      <div aria-hidden className="min-h-0 flex-1" />
      {messages.map((message) => (
        <MessageTurn key={message.id} message={message} />
      ))}
      <TurnStatus status={status} />
    </>
  );
}

/** One conversation turn: the user prompt, or assistant text plus tool activity. */
function MessageTurn({ message }: { message: EveMessage }) {
  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>{messageText(message)}</MessageContent>
      </Message>
    );
  }

  const text = messageText(message);
  // Fold runs of same-kind durable saves into one collapsed group so a busy
  // capture turn ("added a person, then saved six things about them") reads as a
  // short summary by default; interactive review cards and lookups stay in place.
  const units = groupTurnToolEntries(messageToolViews(message));
  const active = messageActiveToolViews(message);

  return (
    <div className="flex flex-col gap-2.5">
      {text ? (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse>{text}</MessageResponse>
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
    <div className="border-t p-3 sm:p-4">
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
          <PromptInputSubmit status={status} />
        </PromptInputFooter>
      </PromptInput>
    </div>
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

  useEffect(() => {
    if (!pendingSubmission || status !== "ready" || autoSubmitting.current) return;
    autoSubmitting.current = true;
    void onSubmit({ files: [], text: pendingSubmission })
      .then(() => controller.textInput.clear())
      .finally(() => {
        setPendingSubmission(null);
        autoSubmitting.current = false;
      });
  }, [controller.textInput, onSubmit, pendingSubmission, status]);

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

function EmptyCapture() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <NotebookPenIcon className="size-5" />
      </span>
      <div className="flex max-w-xs flex-col gap-1.5">
        <p className="text-sm font-medium">Start your notebook</p>
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          Who you talked to, what's going on with them, or something to follow up on.
        </p>
      </div>
    </div>
  );
}
