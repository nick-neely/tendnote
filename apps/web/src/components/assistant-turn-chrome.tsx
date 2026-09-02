"use client";

import { useEffect, useRef, useState } from "react";
import {
  Attachment,
  type AttachmentData,
  AttachmentPreview,
  Attachments,
} from "@/components/ai-elements/attachments";
import { MessageAction, MessageActions } from "@/components/ai-elements/message";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { CheckIcon, ChevronDownIcon, CopyIcon, PencilIcon, RotateCwIcon } from "@/components/icons";
import type { AssistantFilePart } from "@/lib/eve/message-views";
import type { AssistantSource } from "@/lib/eve/sources";
import { cn } from "@/lib/utils";

/**
 * The chrome that hangs off a finished turn: what it read, what you can do with
 * it, and anything it attached.
 *
 * All of it is quiet by default. The actions row is invisible until the turn is
 * hovered or something inside it takes focus — a transcript with three buttons
 * under every paragraph reads as a control panel, not a notebook. On a touch
 * device there is no hover to reveal them with, so they are simply always there.
 */

/** Reveal-on-hover, always visible where hovering is not a thing. */
const HOVER_REVEAL =
  "opacity-0 transition-opacity duration-150 ease-(--motion-ease-out) group-hover/turn:opacity-100 group-focus-within/turn:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100";

/**
 * Copies text and says so for a beat. `navigator.clipboard` is absent over plain
 * HTTP and in older embedded webviews, so the control simply does not render
 * rather than offering a button that silently does nothing.
 */
function useCopyToClipboard(): { copied: boolean; copy: (text: string) => void } | null {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return null;
  }

  return {
    copied,
    copy: (text: string) => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      });
    },
  };
}

/**
 * The actions on a finished assistant turn: take the answer with you, or ask for
 * it again. No thumbs, no share, no download — the transcript is not the record
 * (ADR 0029), and rating the assistant is not a thing this product asks of
 * anyone.
 */
export function AssistantTurnActions({
  answer,
  onRetry,
  retryDisabled,
}: {
  answer: string;
  onRetry: (() => void) | null;
  retryDisabled: boolean;
}) {
  const clipboard = useCopyToClipboard();

  if (!clipboard && !onRetry) {
    return null;
  }

  return (
    <MessageActions className={cn("-ml-1.5", HOVER_REVEAL)}>
      {clipboard ? (
        <MessageAction
          className="text-muted-foreground hover:text-primary"
          onClick={() => clipboard.copy(answer)}
          size="icon"
          tooltip={clipboard.copied ? "Copied" : "Copy answer"}
        >
          {clipboard.copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        </MessageAction>
      ) : null}
      {onRetry ? (
        <MessageAction
          className="text-muted-foreground hover:text-primary"
          disabled={retryDisabled}
          onClick={onRetry}
          size="icon"
          tooltip="Ask again"
        >
          <RotateCwIcon aria-hidden />
        </MessageAction>
      ) : null}
    </MessageActions>
  );
}

/**
 * The one action a message of your own earns: put it back in the composer so you
 * can say it better. It does not branch the conversation — the edited text goes
 * out as the next thing said, which is how a conversation actually works and the
 * only model this transcript can honestly represent (ADR 0030).
 */
export function AssistantUserTurnActions({ onEdit }: { onEdit: () => void }) {
  return (
    <MessageActions className={cn("ml-auto", HOVER_REVEAL)}>
      <MessageAction
        className="text-muted-foreground hover:text-primary"
        onClick={onEdit}
        size="icon"
        tooltip="Edit and send again"
      >
        <PencilIcon aria-hidden />
      </MessageAction>
    </MessageActions>
  );
}

/**
 * The web pages a turn read, behind a one-line count.
 *
 * There is no source part in the stream, so these are synthesized from the two
 * tools that reach the open web (see `lib/eve/sources.ts`). No favicons: a
 * favicon is a request to the site the moment the turn paints, which is the same
 * silent egress the markdown renderer refuses for images.
 */
export function AssistantTurnSources({ sources }: { sources: readonly AssistantSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <Sources className="mb-0 text-[length:var(--text-small)]">
      <SourcesTrigger
        className="group text-muted-foreground transition-colors hover:text-primary"
        count={sources.length}
      >
        <span className="font-medium">
          Used {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 transition-transform duration-200 ease-(--motion-ease-out) group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </SourcesTrigger>
      <SourcesContent className="max-w-full">
        {sources.map((source) => (
          <Source
            className="max-w-full items-baseline text-muted-foreground transition-colors hover:text-primary"
            href={source.url}
            key={source.url}
            rel="noopener noreferrer nofollow"
            title={source.title}
          />
        ))}
      </SourcesContent>
    </Sources>
  );
}

/**
 * Files the assistant attached to a turn. These render as images because they
 * are `file` parts eve projected — a first-party attachment with a known media
 * type — not markdown the model wrote, which stays link-only.
 */
export function AssistantTurnFiles({ files }: { files: readonly AssistantFilePart[] }) {
  if (files.length === 0) {
    return null;
  }

  return (
    <Attachments className="ml-0 w-full" variant="grid">
      {files.map((file, index) => {
        const data: AttachmentData = {
          filename: file.filename,
          id: `${file.filename ?? file.mediaType}:${index}`,
          mediaType: file.mediaType,
          type: "file",
          url: file.url ?? "",
        };
        return (
          <Attachment data={data} key={data.id}>
            <AttachmentPreview />
          </Attachment>
        );
      })}
    </Attachments>
  );
}
