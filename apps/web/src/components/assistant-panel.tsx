"use client";

import { type EveMessage, useEveAgent } from "eve/react";
import { BugIcon, LockIcon, NotebookPenIcon } from "lucide-react";
import { useState } from "react";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
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
import { AssistantToolResult } from "@/components/assistant-tool-result";
import { messageText, messageToolViews } from "@/lib/eve/message-views";
import type { SourceRecordReviewView } from "@/lib/source-record-review-view";
import { cn } from "@/lib/utils";

export type AssistantPersonContext = {
  personId: string;
  personName: string;
};

type AgentStatus = ReturnType<typeof useEveAgent>["status"];

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual note",
  agent: "Assistant note",
  seed: "Sample note",
  contact_import: "Imported contact",
  calendar: "Calendar",
  gmail: "Email",
};

function formatCaptured(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? `${sourceType} context`;
}

/** Owner-safe one-turn client context for the agent, or none when unscoped. */
function clientContextFor(context?: AssistantPersonContext) {
  return context
    ? { person: { id: context.personId, displayName: context.personName } }
    : undefined;
}

export function AssistantPanel({
  initialSourceRecordReviews = [],
  context,
}: {
  initialSourceRecordReviews?: SourceRecordReviewView[];
  context?: AssistantPersonContext;
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

    try {
      await agent.send({ message: text, clientContext: clientContextFor(context) });
    } catch {
      // Failures also surface through `agent.status === "error"` / `agent.error`,
      // which the error row below renders; nothing else to do here.
    }
  }

  return (
    <section
      className="flex h-full min-h-[30rem] flex-col rounded-xl border bg-panel lg:min-h-[34rem]"
      id="assistant"
    >
      <AssistantHeader
        context={context}
        onToggleDebug={() => setShowDebug((on) => !on)}
        showDebug={showDebug}
      />

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="min-h-full justify-end gap-4 p-4 sm:p-5">
          <AssistantConversation
            history={initialSourceRecordReviews}
            messages={messages}
            status={agent.status}
          />
        </ConversationContent>
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

/** Capture history then the live turn, or the empty state before either exists. */
function AssistantConversation({
  history,
  messages,
  status,
}: {
  history: readonly SourceRecordReviewView[];
  messages: readonly EveMessage[];
  status: AgentStatus;
}) {
  const hasContent = history.length > 0 || messages.length > 0;

  if (!hasContent) {
    return <EmptyCapture />;
  }

  return (
    <>
      <div aria-hidden className="min-h-0 flex-1" />
      {history.map((review) => (
        <CaptureNote key={`history-${review.sourceRecord.id}`} review={review} />
      ))}
      <HistoryDivider hasHistory={history.length > 0} hasMessages={messages.length > 0} />
      {messages.map((message) => (
        <MessageTurn key={message.id} message={message} />
      ))}
      <TurnStatus status={status} />
    </>
  );
}

/** Hairline only when persisted history sits above a live conversation. */
function HistoryDivider({
  hasHistory,
  hasMessages,
}: {
  hasHistory: boolean;
  hasMessages: boolean;
}) {
  if (!hasHistory || !hasMessages) {
    return null;
  }

  return <div aria-hidden className="h-px bg-border" />;
}

/** One conversation turn: the user prompt, or assistant text plus tool results. */
function MessageTurn({ message }: { message: EveMessage }) {
  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>{messageText(message)}</MessageContent>
      </Message>
    );
  }

  const text = messageText(message);
  const views = messageToolViews(message);

  return (
    <div className="flex flex-col gap-2.5">
      {text ? (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse>{text}</MessageResponse>
          </MessageContent>
        </Message>
      ) : null}
      {views.map(({ toolCallId, view }) => (
        <AssistantToolResult isNew key={`${message.id}:${toolCallId}`} view={view} />
      ))}
    </div>
  );
}

/** Live turn status line: thinking while a turn streams, or a reach error. */
function TurnStatus({ status }: { status: AgentStatus }) {
  if (status === "submitted") {
    return (
      <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        Thinking…
      </p>
    );
  }

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

  return null;
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

function CaptureNote({
  review,
  isNew = false,
}: {
  review: SourceRecordReviewView;
  isNew?: boolean;
}) {
  const { sourceRecord, component } = review;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3.5",
        isNew && "fade-in slide-in-from-bottom-1 animate-in duration-200 ease-(--motion-ease-out)",
      )}
      data-component-type={component.type}
      data-source-record-id={component.sourceRecordId}
    >
      <p className="max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
        {sourceRecord.content}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          Ready to review
        </span>
        <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
          {sourceLabel(sourceRecord.sourceType)} · {formatCaptured(sourceRecord.createdAt)}
        </span>
      </div>
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
