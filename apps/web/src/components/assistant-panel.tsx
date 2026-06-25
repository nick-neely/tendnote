"use client";

import { CheckIcon, LockIcon, NotebookPenIcon } from "lucide-react";
import { useState } from "react";
import { submitAssistantTurn } from "@/app/actions/assistant";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import type { WebChatToolResult } from "@/lib/eve/bridge";
import type { SourceRecordReviewView } from "@/lib/source-record-review-view";
import { cn } from "@/lib/utils";

export type AssistantPersonContext = {
  personId: string;
  personName: string;
};

type LiveEntry =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string | null;
      toolResults: readonly WebChatToolResult[];
    }
  | { kind: "error"; id: string; text: string };

const TOOL_LABELS: Record<string, string> = {
  capture_source_record: "Logged context",
  capture_memory: "Saved memory",
  create_person: "Added person",
  search_people: "Searched people",
  get_person_context: "Loaded context",
  get_suggested_memory_review: "Suggested memory",
  approve_suggested_memory: "Saved memory",
  dismiss_suggested_memory: "Dismissed suggestion",
};

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ");
}

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
  const [live, setLive] = useState<LiveEntry[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"ready" | "submitted" | "error">("ready");

  const history = initialSourceRecordReviews;
  const hasContent = history.length > 0 || live.length > 0;

  const subtitle = context
    ? `Capturing about ${context.personName}. Saved and linked to them before review.`
    : "Jot anything you want to remember. Saved privately, reviewed before it becomes memory.";

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();

    if (!text) {
      return;
    }

    setLive((current) => [...current, { kind: "user", id: crypto.randomUUID(), text }]);
    setSubmitStatus("submitted");

    try {
      const result = await submitAssistantTurn({
        message: text,
        personId: context?.personId,
        personName: context?.personName,
      });

      setLive((current) => [
        ...current,
        {
          kind: "assistant",
          id: result.sessionId
            ? `assistant-${result.sessionId}-${current.length}`
            : crypto.randomUUID(),
          text: result.assistantText,
          toolResults: result.toolResults,
        },
      ]);
      setSubmitStatus("ready");
    } catch {
      setLive((current) => [
        ...current,
        {
          kind: "error",
          id: crypto.randomUUID(),
          text: "I couldn't reach the assistant. Check the local services and try again.",
        },
      ]);
      setSubmitStatus("error");
      throw new Error("Assistant turn failed.");
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

              {history.length > 0 && live.length > 0 ? (
                <div aria-hidden className="h-px bg-border" />
              ) : null}

              {live.map((entry) => {
                if (entry.kind === "user") {
                  return (
                    <Message from="user" key={entry.id}>
                      <MessageContent>{entry.text}</MessageContent>
                    </Message>
                  );
                }

                if (entry.kind === "assistant") {
                  return (
                    <div className="flex flex-col gap-2" key={entry.id}>
                      {entry.text ? (
                        <Message from="assistant">
                          <MessageContent>{entry.text}</MessageContent>
                        </Message>
                      ) : null}
                      {entry.toolResults.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {entry.toolResults.map((toolResult, index) => (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-[length:var(--text-caption)] text-muted-foreground"
                              // biome-ignore lint/suspicious/noArrayIndexKey: turn-local chips never reorder and carry no stable id until #25 maps persisted records
                              key={`${entry.id}-tool-${index}`}
                            >
                              <CheckIcon aria-hidden className="size-3 text-primary" />
                              {toolLabel(toolResult.toolName)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <p
                    className="text-[length:var(--text-small)] text-destructive leading-[var(--text-small-line)]"
                    key={entry.id}
                    role="alert"
                  >
                    {entry.text}
                  </p>
                );
              })}
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
            <PromptInputSubmit status={submitStatus} />
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
