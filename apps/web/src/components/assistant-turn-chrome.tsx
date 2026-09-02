"use client";

import { useMemo, useState } from "react";
import {
  Attachment,
  type AttachmentData,
  AttachmentPreview,
  Attachments,
} from "@/components/ai-elements/attachments";
import { MessageAction, MessageActions } from "@/components/ai-elements/message";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { CheckIcon, ChevronDownIcon, CopyIcon, PencilIcon, RotateCwIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { AssistantFilePart } from "@/lib/eve/message-views";
import { type AssistantSource, sourceRows } from "@/lib/eve/sources";
import { HOVER_REVEAL } from "@/lib/hover-reveal";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
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

/**
 * The rows the strip shows before the reader asks for the rest. Five is the
 * point where a footnote starts to read as a results page.
 */
const VISIBLE_SOURCES = 5;

/**
 * The actions on a finished assistant turn: take the answer with you, or ask for
 * it again. No thumbs, no share, no download — the transcript is not the record
 * (ADR 0029), and rating the assistant is not a thing this product asks of
 * anyone.
 *
 * Copy is offered only when there are words to copy. A turn that answered purely
 * in cards — a capture that saved a memory and said nothing — has an empty
 * `answer`, and a Copy button there puts an empty clipboard behind a
 * confirmation tick.
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
  const copyable = answer.trim().length > 0 ? clipboard : null;

  if (!copyable && !onRetry) {
    return null;
  }

  return (
    <MessageActions className={cn("-ml-1.5", HOVER_REVEAL)}>
      {copyable ? (
        <MessageAction
          className="text-muted-foreground hover:text-primary"
          onClick={() => copyable.copy(answer)}
          size="icon"
          tooltip={copyable.copied ? "Copied" : "Copy answer"}
        >
          {copyable.copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
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
 * silent egress the markdown renderer refuses for images. The domain carries the
 * distinguishing work instead, in mono because it is a machine fact — without it
 * a ten-row strip is ten interchangeable titles, two of which are often the
 * same words.
 *
 * The registry's `Source` hardcodes its layout classes *before* spreading props,
 * so a `className` replaces them rather than adding to them. Every class this
 * anchor needs is therefore spelled out here, and the children are passed
 * explicitly so the default icon branch never runs.
 */
export function AssistantTurnSources({ sources }: { sources: readonly AssistantSource[] }) {
  const rows = useMemo(() => sourceRows(sources), [sources]);
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return null;
  }

  const shown = expanded ? rows : rows.slice(0, VISIBLE_SOURCES);

  return (
    <Sources className="mb-0 text-[length:var(--text-small)]">
      <SourcesTrigger
        className="group text-muted-foreground transition-colors hover:text-primary"
        count={rows.length}
      >
        <span className="font-medium">
          Used {rows.length} {rows.length === 1 ? "source" : "sources"}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 transition-transform duration-200 ease-(--motion-ease-out) group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </SourcesTrigger>
      <SourcesContent className="max-w-full">
        {shown.map((row) => (
          <Source
            className="flex max-w-full items-baseline gap-2 text-muted-foreground transition-colors hover:text-primary"
            href={row.url}
            key={row.url}
            rel="noopener noreferrer nofollow"
          >
            <span className="min-w-0 truncate">{row.title}</span>
            <span className="shrink-0 font-mono text-[length:var(--text-caption)] text-muted-foreground">
              {row.host}
            </span>
          </Source>
        ))}
        {rows.length > shown.length ? (
          <Button
            className="h-auto w-fit px-0 py-0.5 font-normal text-[length:var(--text-small)] text-muted-foreground hover:bg-transparent hover:text-primary"
            onClick={() => setExpanded(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Show all {rows.length}
          </Button>
        ) : null}
      </SourcesContent>
    </Sources>
  );
}

/**
 * Files attached to a turn. These render as images because they are `file` parts
 * eve projected — a first-party attachment with a known media type — not
 * markdown the model wrote, which stays link-only.
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
