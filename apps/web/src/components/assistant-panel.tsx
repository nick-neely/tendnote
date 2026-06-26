"use client";

import { useEveAgent } from "eve/react";
import { LockIcon, NotebookPenIcon } from "lucide-react";
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
import { AssistantToolResult } from "@/components/assistant-tool-result";
import { messageText, messageToolViews } from "@/lib/eve/message-views";
import type { SourceRecordReviewView } from "@/lib/source-record-review-view";
import { cn } from "@/lib/utils";

export type AssistantPersonContext = {
  personId: string;
  personName: string;
};

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

  const history = initialSourceRecordReviews;
  const messages = agent.data.messages;
  const hasContent = history.length > 0 || messages.length > 0;
  // A turn is dispatched but no event has arrived yet; assistant text/tools render
  // live once streaming begins.
  const isThinking = agent.status === "submitted";

  const subtitle = context
    ? `Capturing about ${context.personName}. Saved and linked to them before review.`
    : "Jot anything you want to remember. Saved privately, reviewed before it becomes memory.";

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();

    if (!text || agent.status !== "ready") {
      return;
    }

    try {
      await agent.send({
        message: text,
        clientContext: context
          ? { person: { id: context.personId, displayName: context.personName } }
          : undefined,
      });
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
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Assistant</h2>
          <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {subtitle}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-[length:var(--text-caption)] text-muted-foreground">
          <LockIcon aria-hidden className="size-3" />
          Private
        </span>
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="min-h-full justify-end gap-4 p-4 sm:p-5">
          {hasContent ? (
            <>
              <div aria-hidden className="min-h-0 flex-1" />
              {history.map((review) => (
                <CaptureNote key={`history-${review.sourceRecord.id}`} review={review} />
              ))}

              {history.length > 0 && messages.length > 0 ? (
                <div aria-hidden className="h-px bg-border" />
              ) : null}

              {messages.map((message) => {
                if (message.role === "user") {
                  return (
                    <Message from="user" key={message.id}>
                      <MessageContent>{messageText(message)}</MessageContent>
                    </Message>
                  );
                }

                const text = messageText(message);
                const views = messageToolViews(message);

                return (
                  <div className="flex flex-col gap-2.5" key={message.id}>
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
              })}

              {isThinking ? (
                <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                  Thinking…
                </p>
              ) : null}

              {agent.status === "error" ? (
                <p
                  className="text-[length:var(--text-small)] text-destructive leading-[var(--text-small-line)]"
                  role="alert"
                >
                  I couldn't reach the assistant. Check the local services and try again.
                </p>
              ) : null}
            </>
          ) : (
            <EmptyCapture />
          )}
        </ConversationContent>
      </Conversation>

      <div className="border-t p-3 sm:p-4">
        <PromptInput onSubmit={handleSubmit}>
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
            <PromptInputSubmit status={agent.status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </section>
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
