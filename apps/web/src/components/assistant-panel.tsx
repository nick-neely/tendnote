"use client";

import { useState } from "react";
import { captureGlobalAssistantSourceRecord } from "@/app/actions/source-records";
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
import { Badge } from "@/components/ui/badge";
import type { SourceRecordReviewView } from "@/lib/source-record-review-view";

type AssistantMessage = {
  id: string;
  from: "user" | "assistant";
  content: string;
  sourceRecordReview?: SourceRecordReviewView;
};

export type AssistantPersonContext = {
  personId: string;
  personName: string;
};

export function AssistantPanel({
  initialSourceRecordReviews = [],
  context,
}: {
  initialSourceRecordReviews?: SourceRecordReviewView[];
  context?: AssistantPersonContext;
}) {
  const introContent = context
    ? `Capturing about ${context.personName}. Notes are saved and linked to them before any review.`
    : "Capture relationship context here. I will save it before any extraction or review.";
  const [messages, setMessages] = useState<AssistantMessage[]>(() => [
    { id: "assistant-intro", from: "assistant" as const, content: introContent },
    ...initialSourceRecordReviews.map((review) => ({
      id: `source-record-${review.sourceRecord.id}`,
      from: "assistant" as const,
      content: "This logged context is saved and ready to review.",
      sourceRecordReview: review,
    })),
  ]);
  const [submitStatus, setSubmitStatus] = useState<"ready" | "submitted" | "error">("ready");

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();

    if (!text) {
      return;
    }

    const userMessageId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: userMessageId,
        from: "user",
        content: text,
      },
    ]);

    setSubmitStatus("submitted");

    try {
      const review = await captureGlobalAssistantSourceRecord({
        retainedContent: text,
        personId: context?.personId,
      });

      setMessages((current) => [
        ...current,
        {
          id: `source-record-${review.sourceRecord.id}`,
          from: "assistant",
          content: "Saved as logged context. It is ready for review before becoming memory.",
          sourceRecordReview: review,
        },
      ]);
      setSubmitStatus("ready");
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          from: "assistant",
          content: "I could not save that note. Check the local services and try again.",
        },
      ]);
      setSubmitStatus("error");
      throw new Error("Source record capture failed.");
    }
  }

  return (
    <section className="flex min-h-[520px] flex-col rounded-xl border bg-panel">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Assistant</h2>
          <p className="text-xs text-muted-foreground">
            {context
              ? `Capturing about ${context.personName}`
              : "Local-first capture with review before memory."}
          </p>
        </div>
        <Badge variant="secondary">No external sends</Badge>
      </div>

      <Conversation className="min-h-0">
        <ConversationContent className="gap-4 p-4">
          {messages.map((message) => (
            <Message from={message.from} key={message.id}>
              <MessageContent>
                <MessageResponse>{message.content}</MessageResponse>
                {message.sourceRecordReview ? (
                  <SourceRecordReviewCard review={message.sourceRecordReview} />
                ) : null}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>

      <div className="border-t p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              placeholder={
                context
                  ? `Note something about ${context.personName}...`
                  : "Remember that Alex is job hunting and likes backend work..."
              }
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <Badge variant="outline">Saved as source record</Badge>
            </PromptInputTools>
            <PromptInputSubmit status={submitStatus} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </section>
  );
}

function SourceRecordReviewCard({ review }: { review: SourceRecordReviewView }) {
  const { sourceRecord, component } = review;
  const capturedDate = sourceRecord.createdAt.slice(0, 10);
  const sourceLabel =
    sourceRecord.sourceType === "manual" ? "manual note" : `${sourceRecord.sourceType} context`;

  return (
    <div
      className="mt-2 flex max-w-full flex-col gap-3 rounded-lg border bg-background p-3"
      data-component-type={component.type}
      data-source-record-id={component.sourceRecordId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Source record</h3>
          <p className="text-xs text-muted-foreground">
            Source: {sourceLabel} from {capturedDate}
          </p>
        </div>
        <Badge variant="outline">{sourceRecord.status}</Badge>
      </div>

      <p className="max-w-[65ch] text-sm">{sourceRecord.content}</p>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">Private</Badge>
        <Badge variant="outline">{sourceRecord.sensitivity}</Badge>
        <Badge variant="outline">{sourceRecord.confidence} confidence</Badge>
      </div>
    </div>
  );
}
