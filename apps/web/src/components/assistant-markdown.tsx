"use client";

import type { AssistantSource } from "@tendnote/domain/assistant-sources";
import { hostLabel } from "@tendnote/domain/assistant-sources";
import type { ComponentProps } from "react";
import { createContext, useContext, useMemo } from "react";
import { defaultRehypePlugins } from "streamdown";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationSource,
  InlineCitationText,
} from "@/components/ai-elements/inline-citation";
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

/* -------------------------------------------------------------------------- *
 * Inline citations
 * -------------------------------------------------------------------------- */

/**
 * A link in the answer that points at a page the turn actually read, plus the
 * number the reader sees on it.
 */
type Citation = {
  /** 1-based, in order of first appearance in this block of prose. */
  readonly index: number;
  readonly source: AssistantSource;
};

/** Resolves a link's href to the source it cites, or `null` if it cites none. */
type CitationLookup = (href: string) => Citation | null;

const NO_CITATIONS: CitationLookup = () => null;

/**
 * How a rendered link reaches its citation.
 *
 * It cannot be a prop: `MessageResponse` is memoized on `children` alone, so a
 * `components` map that closed over the turn's sources would be read on the
 * render that changed the text and ignored on the render that changed the
 * sources. Context crosses `memo`, which is exactly the escape hatch this needs.
 */
const CitationContext = createContext<CitationLookup>(NO_CITATIONS);

/**
 * The comparable identity of a URL, or `null` for anything that is not an
 * ordinary web address.
 *
 * A model writes the URL it saw in a search result; the tool output records the
 * URL it fetched. Those agree on origin and path and disagree on the rest: a
 * trailing slash, a `#section` the model added to point at a heading, tracking
 * query that one side dropped. Origin + path is the part both sides mean by "the
 * page", so it is the part compared. Two pages that differ only in query — a
 * search results page, say — collide under this rule, and that is the accepted
 * cost of matching the `?utm=` twins that actually occur.
 */
function citationKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * A lookup over one turn's sources, numbering them as the reader meets them.
 *
 * Numbering by position in `sources` would leave gaps — a turn that read five
 * pages and linked the fourth would print a lone "4" — so a number is handed
 * out on first use and remembered, which makes the sequence in the prose read
 * 1, 2, 3 and makes every link to one source carry the same number. The
 * assignment happens while rendering, but it is idempotent: a URL that already
 * has a number keeps it, so a re-render, a Strict Mode double render, or a
 * discarded concurrent render all produce the same numbers.
 */
function createCitationLookup(sources: readonly AssistantSource[] | undefined): CitationLookup {
  if (sources === undefined || sources.length === 0) {
    return NO_CITATIONS;
  }

  const byKey = new Map<string, AssistantSource>();
  for (const source of sources) {
    const key = citationKey(source.url);
    // First one wins: `turnSources` is already in the order the turn read them.
    if (key !== null && !byKey.has(key)) {
      byKey.set(key, source);
    }
  }

  const numbers = new Map<string, number>();

  return (href: string) => {
    const key = citationKey(href);
    if (key === null) {
      return null;
    }
    const source = byKey.get(key);
    if (source === undefined) {
      return null;
    }
    let index = numbers.get(key);
    if (index === undefined) {
      index = numbers.size + 1;
      numbers.set(key, index);
    }
    return { index, source };
  };
}

/** The element the rehype pass wraps a link in, and the attribute it carries. */
const CITATION_TAG = "tendnote-citation";
const CITATION_HREF_ATTRIBUTE = "data-citation-href";

/**
 * The slice of hast the pass touches. Spelled out rather than imported from
 * `@types/hast`: that package reaches this app only as a transitive dependency
 * of Streamdown's own toolchain, and a citation marker is not worth a direct
 * dependency on someone else's transitive one.
 */
type HastNode = { type: string; children?: HastNode[] };
type HastElement = HastNode & {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
};

function isElement(node: HastNode): node is HastElement {
  return node.type === "element";
}

/**
 * Wraps every link in a marker element the renderer can hang a citation on.
 *
 * The alternative — overriding the `a` slot — would mean re-rendering the anchor
 * ourselves, and Streamdown does not render a bare anchor: link safety is on by
 * default, so a Markdown link is a button that discloses its destination in a
 * modal before it opens anything. That confirmation is the point on a surface
 * whose text is model-authored, so the link is left exactly as Streamdown makes
 * it and the citation is added around it.
 *
 * The pass is static — it marks every link, not only cited ones — because it
 * travels with the `rehypePlugins` array, which must keep a stable identity for
 * the same reason the components map does. Which links are citations is decided
 * at render time, from context.
 */
function rehypeMarkLinks() {
  return (tree: HastNode) => {
    const walk = (parent: HastNode) => {
      const children = parent.children;
      if (children === undefined) {
        return;
      }
      for (const [index, child] of children.entries()) {
        if (!isElement(child)) {
          continue;
        }
        if (child.tagName === "a" && typeof child.properties.href === "string") {
          const marker: HastElement = {
            children: [child],
            properties: { [CITATION_HREF_ATTRIBUTE]: child.properties.href },
            tagName: CITATION_TAG,
            type: "element",
          };
          children[index] = marker;
          continue;
        }
        walk(child);
      }
    };

    walk(tree);
  };
}

/**
 * Streamdown's own rehype pass plus ours. Passing `rehypePlugins` replaces
 * Streamdown's default list rather than extending it, so the default is spread
 * back in from the export it publishes for exactly this.
 */
const ASSISTANT_REHYPE_PLUGINS = [...Object.values(defaultRehypePlugins), rehypeMarkLinks];

/**
 * A link that cites a source: the link as Streamdown rendered it, followed by a
 * quiet numbered marker whose hover card names the page.
 *
 * The marker is the only new affordance — the link keeps its own behaviour — so
 * the card is informational, not a second route to the page. It opens on hover
 * and on focus (the marker is tabbable), which puts the title, the full URL, and
 * the host in front of a keyboard reader too. The marker's own label repeats the
 * source and host, so a reader who never sees the card still gets the citation;
 * that is why the marker is a labelled, focusable badge rather than a button —
 * it commands nothing, and a button that does nothing when pressed would lie.
 */
function MarkdownCitationLink({ children, ...props }: ComponentProps<"span">) {
  const lookup = useContext(CitationContext);
  // `data-*` attributes are not on `ComponentProps<"span">`; the marker element
  // is ours, so the attribute is always there and always a string.
  const href = (props as Record<string, unknown>)[CITATION_HREF_ATTRIBUTE];
  const citation = typeof href === "string" ? lookup(href) : null;

  if (citation === null) {
    return <>{children}</>;
  }

  const { index, source } = citation;
  const host = hostLabel(source.url);
  const published = publishedLabel(source.publishedAt);

  return (
    <InlineCitation>
      {/*
       * The registry tints the cited text with `bg-accent` on hover. `--accent`
       * is clay here, and DESIGN.md reserves clay for tentative and review
       * state, so a citation must not borrow it just for a hover.
       */}
      <InlineCitationText className="group-hover:bg-transparent">{children}</InlineCitationText>
      <InlineCitationCard>
        <InlineCitationCardTrigger
          aria-label={`Source ${index}: ${source.title} (${host})`}
          className="ml-0.5 h-4 min-w-4 rounded-sm bg-transparent px-1 align-super font-mono text-[0.6875rem] text-muted-foreground leading-none hover:border-primary/40 hover:text-primary focus-visible:text-primary data-[state=open]:border-primary/40 data-[state=open]:text-primary"
          sources={[source.url]}
          tabIndex={0}
          variant="outline"
        >
          {index}
        </InlineCitationCardTrigger>
        <InlineCitationCardBody className="w-72 p-3">
          <InlineCitationSource description={host} title={source.title} url={source.url} />
          {published === null ? null : (
            <p className="mt-2 font-mono text-muted-foreground text-xs">{published}</p>
          )}
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}

/**
 * A publication date the provider reported, as a plain day. Fixed to `en-US`
 * and UTC like the rest of the app's dates: a publication date is a day, not a
 * moment, and shifting it into the reader's zone would move some of them.
 */
function publishedLabel(publishedAt: string | undefined): string | null {
  if (publishedAt === undefined) {
    return null;
  }
  const parsed = new Date(publishedAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
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
  [CITATION_TAG]: MarkdownCitationLink as MarkdownComponents["span"],
};

export function AssistantMarkdown({
  children,
  className,
  sources,
}: {
  children: string;
  className?: string;
  /**
   * The pages this turn actually read (`turnSources`). A link whose href matches
   * one of them renders as a numbered citation; every other link renders exactly
   * as it does without this prop.
   */
  sources?: readonly AssistantSource[];
}) {
  const lookup = useMemo(() => createCitationLookup(sources), [sources]);

  return (
    <CitationContext.Provider value={lookup}>
      <MessageResponse
        className={className}
        components={ASSISTANT_MARKDOWN_COMPONENTS}
        rehypePlugins={ASSISTANT_REHYPE_PLUGINS}
      >
        {children}
      </MessageResponse>
    </CitationContext.Provider>
  );
}
