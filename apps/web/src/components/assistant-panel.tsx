"use client";

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
import { Badge } from "@/components/ui/badge";

type AssistantMessage = {
  id: string;
  from: "user" | "assistant";
  content: string;
};

const initialMessages: AssistantMessage[] = [
  {
    id: "assistant-intro",
    from: "assistant",
    content:
      "Tendnote is ready for local capture. I can search the seeded people now; writes and outbound actions stay behind explicit approval gates.",
  },
];

export function AssistantPanel() {
  const [messages, setMessages] = useState<AssistantMessage[]>(initialMessages);

  function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();

    if (!text) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        from: "user",
        content: text,
      },
      {
        id: crypto.randomUUID(),
        from: "assistant",
        content:
          "Phase 0 has the assistant surface and `search_people` tool scaffolded. The next slice will route this input through Eve and persist approved people, memories, and follow-ups.",
      },
    ]);
  }

  return (
    <section className="flex min-h-[520px] flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Assistant</h2>
          <p className="text-xs text-muted-foreground">
            Local-first surface for capture, recall, and draft review.
          </p>
        </div>
        <Badge variant="secondary">Approval gated</Badge>
      </div>

      <Conversation className="min-h-0">
        <ConversationContent className="gap-4 p-4">
          {messages.map((message) => (
            <Message from={message.from} key={message.id}>
              <MessageContent>
                <MessageResponse>{message.content}</MessageResponse>
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>

      <div className="border-t p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea placeholder="Remember that Alex is job hunting and likes backend work..." />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <Badge variant="outline">No external sends</Badge>
            </PromptInputTools>
            <PromptInputSubmit status="ready" />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </section>
  );
}
