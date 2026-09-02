"use client";

import { useEffect, useRef } from "react";
import { ChainOfThought, ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought";
import { Reasoning, ReasoningTrigger, useReasoning } from "@/components/ai-elements/reasoning";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { Shimmer } from "@/components/ui/shimmer";
import type { AssistantActivityStep, AssistantTurnReasoning } from "@/lib/eve/message-views";
import { cn } from "@/lib/utils";

/**
 * What a turn was doing before it answered, folded into one disclosure at the top
 * of the turn.
 *
 * Before this, a turn's ambient lookups trailed *underneath* the answer as bare
 * lines ("search people"), so the last thing on screen after a reply was
 * housekeeping — and the raw tool name at that. Work belongs before the answer,
 * the way it happened, and it belongs collapsed: the reader wants the reply, and
 * the trace is there for the moment they don't trust it.
 *
 * The shell is AI Elements' `Reasoning`, which already owns the two behaviors
 * that are easy to get wrong: it opens itself while the turn streams and closes
 * itself about a second after it settles (once — a reader who reopens it keeps
 * it open), and it measures its own elapsed time when nothing durable is passed.
 * Everything visible is Tendnote's: the pulsing sage dot and the sanctioned
 * `Shimmer` instead of the registry's brain glyph, plain past-tense copy instead
 * of "Chain of Thought".
 *
 * One deviation from the brief worth naming: the body renders through
 * `AssistantMarkdown` rather than the registry's `ReasoningContent`. That
 * component hard-codes a bare `Streamdown`, which renders a Markdown image as a
 * real image element — the exact egress channel `assistant-markdown.tsx` exists to
 * close, and reasoning text is as model-controlled as the answer is. The
 * disclosure's own chrome (the collapse animation, the muted type) is kept
 * verbatim from that component.
 */

/**
 * While a turn is live the reasoning is a *viewport*, not a document: about five
 * lines, scrolled to whatever the model just wrote, fading out at the top so the
 * clipping reads as deliberate rather than as a broken container. Without it an
 * auto-opened disclosure grows to a few hundred pixels and pushes the answer off
 * the panel before a word of it lands. Once the turn settles the cap comes off —
 * the reader who opens a finished disclosure wants the whole thing.
 */
const STREAMING_REASONING_VIEWPORT =
  "max-h-40 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent_0,#000_1.5rem)]";

/**
 * Keeps a scrolling element pinned to its own bottom as content arrives. The
 * one authored motion moment on the turn, so it is a real scroll animation
 * rather than a jump — and it is exactly a jump for anyone who asked for less
 * motion, since a self-scrolling box is precisely the thing that setting means.
 */
function useStickToBottom(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  content: string,
) {
  const shown = useRef("");

  useEffect(() => {
    const node = ref.current;
    // Only new words move the viewport. A re-render that changed something else
    // must not yank a reader who has just scrolled up inside it.
    if (!node || !active || content === shown.current) {
      return;
    }
    shown.current = content;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // jsdom implements `scrollTop` but not `scrollTo`, and so do older webviews.
    if (reduced || typeof node.scrollTo !== "function") {
      node.scrollTop = node.scrollHeight;
      return;
    }
    node.scrollTo({ behavior: "smooth", top: node.scrollHeight });
  }, [active, content, ref]);
}

/** A tool call still running: the pulsing sage dot the composer's shimmer uses. */
function ActiveStepIcon({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex items-center justify-center", className)}>
      <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
    </span>
  );
}

/**
 * A settled call. A check rather than a coloured dot: the difference between
 * running and done has to survive being read in greyscale (DESIGN.md §8).
 */
function CompleteStepIcon({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex items-center justify-center", className)}>
      <CheckIcon className="size-3 text-muted-foreground/70" />
    </span>
  );
}

function secondsLabel(seconds: number): string {
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

/**
 * The trigger's own copy, read from the disclosure's context so the elapsed time
 * is whichever of the two sources is available: the durable stream timing the
 * panel passes down, or the component's own clock when the stream did not say.
 */
function ActivityTriggerLabel({ thought }: { thought: boolean }) {
  const { duration, isOpen, isStreaming } = useReasoning();

  const settled = thought
    ? duration === undefined
      ? "Thought it through"
      : `Thought for ${secondsLabel(duration)}`
    : duration === undefined
      ? "Worked on it"
      : `Worked for ${secondsLabel(duration)}`;

  return (
    <>
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isStreaming ? "bg-primary motion-safe:animate-pulse" : "bg-muted-foreground/40",
        )}
      />
      {isStreaming ? <Shimmer>Working…</Shimmer> : <span>{settled}</span>}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 transition-transform duration-200 ease-(--motion-ease-out) motion-reduce:transition-none",
          isOpen ? "rotate-180" : "rotate-0",
        )}
      />
    </>
  );
}

/**
 * The activity block for one assistant turn, or nothing when the turn simply
 * answered. `streaming` is the *turn's* liveness rather than any one part's: a
 * disclosure that reopened and reclosed between every tool call would be four
 * animations where the turn deserves one.
 */
export function AssistantTurnActivity({
  durationSeconds,
  reasoning,
  steps,
  streaming,
}: {
  durationSeconds: number | null;
  reasoning: AssistantTurnReasoning | null;
  steps: readonly AssistantActivityStep[];
  streaming: boolean;
}) {
  const thought = Boolean(reasoning?.text);
  const reasoningText = reasoning?.text ?? "";
  const reasoningRef = useRef<HTMLDivElement>(null);
  useStickToBottom(reasoningRef, streaming, reasoningText);

  if (!reasoning && steps.length === 0) {
    return null;
  }

  return (
    <Reasoning className="mb-0" duration={durationSeconds ?? undefined} isStreaming={streaming}>
      <ReasoningTrigger className="w-fit gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        <ActivityTriggerLabel thought={thought} />
      </ReasoningTrigger>
      <CollapsibleContent
        className={cn(
          "mt-2 flex flex-col gap-3 border-border border-l pl-3 text-[length:var(--text-small)] text-muted-foreground",
          "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        )}
      >
        {reasoning?.text ? (
          <div className={cn(streaming && STREAMING_REASONING_VIEWPORT)} ref={reasoningRef}>
            {/* Tighter paragraph rhythm than the answer's: this is an aside the
                reader opened deliberately, and it is often many short paragraphs. */}
            <AssistantMarkdown className="[&>ol]:my-2 [&>p]:my-2 [&>ul]:my-2 [&_ol]:pl-4 [&_ul]:pl-4">
              {reasoning.text}
            </AssistantMarkdown>
          </div>
        ) : null}
        {steps.length > 0 ? (
          <ChainOfThought className="space-y-2">
            {steps.map((step) => (
              <ChainOfThoughtStep
                description={step.description ?? undefined}
                icon={step.status === "active" ? ActiveStepIcon : CompleteStepIcon}
                key={step.toolCallId}
                label={step.status === "active" ? <Shimmer>{step.label}</Shimmer> : step.label}
                status={step.status}
              />
            ))}
          </ChainOfThought>
        ) : null}
      </CollapsibleContent>
    </Reasoning>
  );
}
