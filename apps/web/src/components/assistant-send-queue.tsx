"use client";

import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemContent,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import { SendIcon, XIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { QueuedMessage } from "@/lib/eve/send-queue";

/**
 * What you said while the assistant was still answering the last thing.
 *
 * Eve takes one turn at a time, so until now a second Enter was simply refused
 * and the words bounced back into the composer. That is honest but useless: the
 * thought was finished, and the person should not have to babysit the stream to
 * get it in. Queued messages wait here in plain sight and go out in order the
 * moment the turn settles.
 *
 * Two escape hatches, because a queue you cannot get out of is a trap. **Remove**
 * takes an item back. **Send now** steers: it cancels the running turn and starts
 * a replacement with this message — a real interruption, so the tooltip says so
 * rather than implying the queue simply moved faster.
 */
export function AssistantSendQueue({
  items,
  onRemove,
  onSendNow,
}: {
  items: readonly QueuedMessage[];
  onRemove: (id: string) => void;
  onSendNow: (id: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Queue className="mb-3 border-border bg-card shadow-none">
      <QueueSection>
        <QueueSectionTrigger className="bg-transparent px-1 py-1 hover:bg-transparent hover:text-foreground">
          <QueueSectionLabel
            className="text-[length:var(--text-small)]"
            count={items.length}
            label={items.length === 1 ? "queued message" : "queued messages"}
          />
        </QueueSectionTrigger>
        <QueueSectionContent>
          <QueueList>
            {items.map((item) => (
              <QueueItem className="flex-row items-center gap-2 px-1" key={item.id}>
                <QueueItemContent className="text-[length:var(--text-small)]">
                  {item.text}
                </QueueItemContent>
                <QueueItemActions className="shrink-0">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <QueueItemAction
                          aria-label="Send now"
                          className="[@media(hover:none)]:opacity-100"
                          onClick={() => onSendNow(item.id)}
                        >
                          <SendIcon aria-hidden className="size-3.5" />
                        </QueueItemAction>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Send now — this stops the current answer</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <QueueItemAction
                          aria-label="Remove from the queue"
                          className="[@media(hover:none)]:opacity-100"
                          onClick={() => onRemove(item.id)}
                        >
                          <XIcon aria-hidden className="size-3.5" />
                        </QueueItemAction>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Remove</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </QueueItemActions>
              </QueueItem>
            ))}
          </QueueList>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  );
}
