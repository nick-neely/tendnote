"use client";

import type { ComponentProps } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { LinkIcon } from "@/components/icons";

/**
 * Markdown written by Eve, rendered so it cannot reach the network on its own.
 *
 * Streamdown renders a Markdown image — and a raw `<img>` that survives its HTML
 * sanitizer — as a real `<img src>`, which the browser fetches the instant the
 * response paints. That request happens with no click and no confirmation, so an
 * image URL in model output is an egress channel: it leaks the reader's IP and the
 * moment they read, and a URL carrying private relationship context in its path or
 * query exfiltrates that context outright. Eve's own text is model-controlled, and
 * `web_fetch` puts untrusted third-party prose inside the same turn, so "Eve would
 * not emit that" is exactly the assumption prompt injection is built to break.
 *
 * So images render as links: the alt text, a link glyph, and no request until the
 * reader deliberately makes one. The `img` override catches both routes into the
 * renderer (Markdown `![alt](url)` and raw HTML) because Streamdown funnels both
 * through the same component slot.
 *
 * This is the renderer for every surface that shows model-authored Markdown — the
 * transcript and the draft body — so the protection cannot be forgotten on one of
 * them. Links keep Streamdown's own click-to-confirm treatment.
 */

/** Renders `![alt](url)` as an inert label plus a deliberate link. */
function MarkdownImageLink({ alt, src }: ComponentProps<"img">) {
  const label = alt?.trim() || "Image";
  const href = typeof src === "string" ? safeImageHref(src) : null;

  return (
    <span
      className="inline-flex max-w-full items-baseline gap-1 align-baseline"
      data-assistant-image="link"
    >
      <LinkIcon aria-hidden className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
      {href ? (
        <a
          className="wrap-anywhere font-medium text-primary underline-offset-4 hover:underline"
          href={href}
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          {label}
        </a>
      ) : (
        <span className="text-muted-foreground">{label}</span>
      )}
    </span>
  );
}

/**
 * The href, but only for a URL a browser would treat as an ordinary web address.
 * Anything else — a `javascript:` or `data:` source, or a string that is not a URL
 * at all — keeps its alt text and loses the link rather than being handed to the
 * browser to interpret.
 */
function safeImageHref(src: string): string | null {
  try {
    const url = new URL(src, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

type MarkdownComponents = NonNullable<ComponentProps<typeof MessageResponse>["components"]>;

/**
 * Module-level so the object identity is stable: `MessageResponse` is memoized on
 * its children alone, and a fresh map each render would be silently ignored anyway.
 *
 * The cast is upstream's: streamdown's `Components` intersects a per-tag component
 * map with a catch-all `Record<string, unknown>` index signature, and no override
 * can satisfy both halves at once - a correctly typed `img` fails the index
 * signature, and an index-signature-shaped one fails the `img` slot. The cast pins
 * the tag-correct half, which is the one that describes what streamdown actually
 * passes: it renders `img` nodes with the element's own attributes.
 */
const ASSISTANT_MARKDOWN_COMPONENTS: MarkdownComponents = {
  img: MarkdownImageLink as MarkdownComponents["img"],
};

export function AssistantMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <MessageResponse className={className} components={ASSISTANT_MARKDOWN_COMPONENTS}>
      {children}
    </MessageResponse>
  );
}
