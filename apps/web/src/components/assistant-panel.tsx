"use client";

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
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { AssistantDebugTrace } from "@/components/assistant-debug-trace";
import { AssistantToolGroup, AssistantToolResult } from "@/components/assistant-tool-result";
import {
  ChatFollowupReviewCard,
  ChatFollowupReviewList,
} from "@/components/chat-followup-review-card";
import { ChatReviewCard, ChatReviewList } from "@/components/chat-review-card";
import { Shimmer } from "@/components/ui/shimmer";
import {
  groupTurnToolEntries,
  messageActiveToolViews,
  messageText,
  messageToolViews,
} from "@/lib/eve/message-views";
import type { GroupableToolView } from "@/lib/eve/tool-result-view";
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

export function AssistantPanel({ context }: { context?: AssistantPersonContext }) {
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

    try {
      await agent.send({ message: text, clientContext: clientContextFor(context) });
    } catch {
      // Failures also surface through `agent.status === "error"` / `agent.error`,
      // which the error row below renders; nothing else to do here.
    }
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

      <AssistantComposer context={context} onSubmit={handleSubmit} status={agent.status} />
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
      {units.map((unit) => {
        if (unit.type === "group") {
          const [{ toolCallId }] = unit.entries;
          return (
            <AssistantToolGroup
              isNew
              key={`${message.id}:group:${unit.kind}:${toolCallId}`}
              kind={unit.kind}
              views={unit.entries.map((entry) => entry.view as GroupableToolView)}
            />
          );
        }

        // Tentative suggestions are the tool results the user can act on inline
        // (approve/dismiss), so they get the interactive card(s); everything else
        // is a read-only record of what Eve did.
        const { toolCallId, view } = unit.entry;
        const key = `${message.id}:${toolCallId}`;

        if (view.kind === "suggested_memory_review") {
          return <ChatReviewCard isNew item={view} key={key} />;
        }

        if (view.kind === "suggested_memory_review_list") {
          return <ChatReviewList isNew key={key} view={view} />;
        }

        if (view.kind === "suggested_followup_review") {
          return <ChatFollowupReviewCard isNew item={view} key={key} />;
        }

        if (view.kind === "suggested_followup_review_list") {
          return <ChatFollowupReviewList isNew key={key} view={view} />;
        }

        return <AssistantToolResult isNew key={key} view={view} />;
      })}
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
        I couldn't reach the assistant. Check the local services and try again.
      </p>
    );
  }

  return thinking ? <WorkingLine label="Thinking…" /> : null;
}

function AssistantComposer({
  context,
  status,
  onSubmit,
}: {
  context?: AssistantPersonContext;
  status: AgentStatus;
  onSubmit: (message: PromptInputMessage) => void;
}) {
  return (
    <div className="border-t p-3 sm:p-4">
      <PromptInput onSubmit={onSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={
              context
                ? `Note something about ${context.personName}…`
                : "Remember that Alex is job hunting and prefers backend work…"
            }
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
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
          Jot down who you talked to, what's going on with them, or a follow-up to remember. Nothing
          is sent — it's saved for you to review.
        </p>
      </div>
    </div>
  );
}
