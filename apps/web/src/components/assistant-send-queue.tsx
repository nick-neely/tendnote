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
import { REVEAL_ON_FOCUS } from "@/lib/hover-reveal";

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
 *
 * When the conversation ends the strip does not go with the composer. Whatever is
 * still in it was never sent, and silently deleting the user's own words at the
 * exact moment the session dies is the one thing this list exists to prevent: it
 * stays, read-only, with a line saying so, and Remove still works so the reader
 * can clear it once they have copied what they wanted.
 */
export function AssistantSendQueue({
  items,
  note,
  onRemove,
  onSendNow,
}: {
  items: readonly QueuedMessage[];
  /** A plain fact about the whole list, e.g. that none of it went out. */
  note?: string;
  onRemove: (id: string) => void;
  /** `null` where nothing can be sent any more — the list is a record, not a queue. */
  onSendNow: ((id: string) => void) | null;
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
                    {onSendNow ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {/* The registry reveals these on hover alone, which
                              leaves a Tab stop on an invisible button. */}
                          <QueueItemAction
                            aria-label="Send now"
                            className={REVEAL_ON_FOCUS}
                            onClick={() => onSendNow(item.id)}
                          >
                            <SendIcon aria-hidden className="size-3.5" />
                          </QueueItemAction>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Send now — this stops the current answer</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <QueueItemAction
                          aria-label="Remove from the queue"
                          className={REVEAL_ON_FOCUS}
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
          {note ? (
            <p className="px-1 pt-1 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              {note}
            </p>
          ) : null}
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  );
}
