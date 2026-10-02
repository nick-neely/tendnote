"use client";

import { Button } from "@tendnote/ui/button";
import { cn } from "@tendnote/ui/cn";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, PlusIcon, XIcon } from "@/components/icons";
import { StorySteps } from "@/components/story-steps";
import { useMounted, useReducedMotion } from "@/components/use-reduced-motion";
import { useTypedText } from "@/components/use-typed-text";
import { beatForProgress, beats, NOTE_TEXT, progressForBeat, QUESTION_TEXT } from "./loop-script";

/*
 * The hero is one authored moment: a notebook stage that plays Sam's week
 * through the relationship loop while the visitor scrolls. The section grows
 * tall, the stage pins under the header, and the scroll position picks the
 * beat. Beat titles double as step buttons, so the keyboard reaches every
 * state without scrolling. With reduced motion (or before hydration) nothing
 * pins: the section is a normal hero, and the step buttons switch the stage
 * directly.
 */

const HEADER_HEIGHT = 56;
const STEPS_LABEL = "Steps in Sam's week";

/*
 * Where the pin starts and how far it runs, in viewport pixels. `slot` is the
 * stage's non-sticky grid cell: its offset inside the section is the stage's
 * flow position, which a stuck element's own offsetTop no longer reports.
 */
function pinGeometry(section: HTMLElement, slot: HTMLElement, sticky: HTMLElement) {
  const rect = section.getBoundingClientRect();
  return {
    start: rect.top + slot.offsetTop,
    travel: rect.height - slot.offsetTop - sticky.offsetHeight,
  };
}

/** Scroll progress through a pinned section: 0 when the stage pins, 1 when it releases. */
function usePinProgress(
  enabled: boolean,
  sectionRef: React.RefObject<HTMLElement | null>,
  slotRef: React.RefObject<HTMLElement | null>,
  stickyRef: React.RefObject<HTMLElement | null>,
): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const section = sectionRef.current;
    const slot = slotRef.current;
    const sticky = stickyRef.current;
    if (!section || !slot || !sticky) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const { start, travel } = pinGeometry(section, slot, sticky);
      if (travel <= 0) {
        setProgress(1);
        return;
      }
      setProgress(Math.min(1, Math.max(0, (HEADER_HEIGHT - start) / travel)));
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [enabled, sectionRef, slotRef, stickyRef]);

  return progress;
}

export function LoopHero() {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  const pinned = mounted && !reduced;

  const sectionRef = useRef<HTMLElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const progress = usePinProgress(pinned, sectionRef, slotRef, stickyRef);
  const [manualBeat, setManualBeat] = useState(0);

  const live = pinned ? beatForProgress(progress) : { beat: manualBeat, t: 1 };
  // Types the opening note on arrival at the first beat (effects only run once
  // hydrated, so the server render stays empty); later beats show it whole.
  const typed = useTypedText(NOTE_TEXT, live.beat === 0, reduced);

  const goToBeat = useCallback(
    (index: number) => {
      const section = sectionRef.current;
      const slot = slotRef.current;
      const sticky = stickyRef.current;
      if (!pinned || !section || !slot || !sticky) {
        setManualBeat(index);
        return;
      }
      const { start, travel } = pinGeometry(section, slot, sticky);
      const top = window.scrollY + start - HEADER_HEIGHT + progressForBeat(index) * travel;
      window.scrollTo({ top, behavior: "smooth" });
    },
    [pinned],
  );

  return (
    <section
      aria-labelledby="home-title"
      className={cn("relative", pinned && "h-[calc(100svh+440svh)]")}
      ref={sectionRef}
    >
      <div className="mx-auto grid h-full max-w-6xl grid-rows-[auto_1fr] items-start gap-x-16 px-gutter sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:grid-rows-1">
        <Intro beat={live.beat} onSelect={goToBeat} pinned={pinned} />

        <div className="self-stretch" ref={slotRef}>
          <div
            className={cn(
              "flex flex-col gap-4 pt-3 pb-14 lg:min-h-[calc(100svh-3.5rem)] lg:justify-center lg:py-0",
              pinned && "sticky top-14",
            )}
            ref={stickyRef}
          >
            <Stage beat={live.beat} t={live.t} typed={typed} typing={pinned && live.beat === 0} />
            <StorySteps
              className="lg:hidden"
              compact
              current={live.beat}
              label={STEPS_LABEL}
              onSelect={goToBeat}
              steps={beats}
            />
            <StageCaption hint={pinned && progress < 0.03} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Intro({
  beat,
  onSelect,
  pinned,
}: {
  beat: number;
  onSelect: (index: number) => void;
  pinned: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6 pt-14 pb-8 sm:pt-20 lg:min-h-[calc(100svh-3.5rem)] lg:justify-center lg:py-0",
        pinned && "lg:sticky lg:top-14",
      )}
    >
      <h1
        className="font-display text-[2.5rem] leading-[1.08] font-semibold sm:text-[3.25rem] lg:text-[3.5rem]"
        id="home-title"
      >
        Be the friend who remembers.
      </h1>
      <p className="max-w-[46ch] text-lg leading-7 text-muted-foreground">
        The interview on Thursday. The move next month. The name of their new dog. Tendnote keeps
        what people tell you, and brings it back on the day it matters.
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/demo">Explore the demo</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/pricing">View pricing</Link>
          </Button>
        </div>
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          The demo needs no account. The plan has fourteen days to change your mind.
        </p>
      </div>
      <StorySteps
        className="mt-4 hidden lg:block"
        current={beat}
        label={STEPS_LABEL}
        onSelect={onSelect}
        steps={beats}
      />
    </div>
  );
}

/** The fiction disclosure, with the scroll hint that fades once the week starts. */
function StageCaption({ hint }: { hint: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        Sam is fictional. Every detail here is invented.
      </p>
      <p
        aria-hidden
        className={cn(
          "hidden shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground transition-opacity duration-300 lg:flex",
          hint ? "opacity-100" : "opacity-0",
        )}
      >
        <ArrowDownIcon aria-hidden className="size-3.5 tn-nudge" />
        Scroll to follow the week
      </p>
    </div>
  );
}

/**
 * One day of the story. The two days sit in a stack; the one that is not live
 * collapses to nothing, so the stage is only ever as tall as what it shows and
 * the swap from Tuesday to Friday reads as one surface changing, not two.
 */
function Day({ children, shown }: { children: React.ReactNode; shown: boolean }) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity,filter,transform] duration-500 ease-(--motion-ease-out)",
        shown
          ? "grid-rows-[1fr] translate-y-0 opacity-100 blur-0"
          : "grid-rows-[0fr] -translate-y-1 opacity-0 blur-[3px]",
      )}
    >
      <div className="overflow-hidden">
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}

/** The notebook. Decorative: the beat list carries the same story as text. */
function Stage({
  beat,
  t,
  typed,
  typing,
}: {
  beat: number;
  t: number;
  typed: string;
  typing: boolean;
}) {
  const friday = beat >= 3;
  const confirmed = beat > 1 || (beat === 1 && t >= 0.5);
  const pressing = beat === 1 && t >= 0.3 && t < 0.5;
  const asked = beat === 4 && t >= 0.35;

  return (
    <div aria-hidden className="flex flex-col gap-3 rounded-2xl border bg-panel p-3 sm:p-4" inert>
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="size-2 rounded-full bg-primary" />
          Assistant
        </span>
        <span className="grid font-mono text-xs text-muted-foreground">
          <span
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-500",
              friday ? "opacity-0" : "opacity-100",
            )}
          >
            Tuesday
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-500",
              friday ? "opacity-100" : "opacity-0",
            )}
          >
            Friday
          </span>
        </span>
      </div>

      <div className="flex flex-col">
        <Day shown={!friday}>
          {beat >= 1 ? <UserTurn text={NOTE_TEXT} /> : null}
          {beat >= 1 ? <MemoryCard confirmed={confirmed} pressing={pressing} /> : null}
          {beat >= 2 ? <FollowUpCard /> : null}
          <Composer
            caret={typing && typed.length < NOTE_TEXT.length}
            placeholder="What did they tell you?"
            text={beat === 0 ? typed : ""}
          />
        </Day>

        <Day shown={friday}>
          <TodayPanel />
          {asked ? <UserTurn text={QUESTION_TEXT} /> : null}
          {asked ? <Answer /> : null}
          <Composer
            caret={false}
            placeholder="Ask what you remember"
            text={beat === 4 && !asked ? QUESTION_TEXT : ""}
          />
        </Day>
      </div>
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="tn-rise flex justify-end">
      <p className="max-w-[88%] rounded-xl bg-secondary px-3 py-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-secondary-foreground">
        {text}
      </p>
    </div>
  );
}

function MemoryCard({ confirmed, pressing }: { confirmed: boolean; pressing: boolean }) {
  const chip =
    "col-start-1 row-start-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-opacity duration-300";
  return (
    <article
      className={cn(
        "tn-rise flex flex-col gap-2 rounded-xl border px-3.5 py-3 transition-colors duration-500 ease-(--motion-ease-out)",
        confirmed ? "border-border bg-surface" : "border-accent/25 bg-accent-soft/45",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Sam Rivera</span>
        <span className="grid text-[length:var(--text-caption)] font-medium">
          <span
            className={cn(
              chip,
              "bg-accent/15 text-accent",
              confirmed ? "opacity-0" : "opacity-100",
            )}
          >
            Suggested
          </span>
          <span
            className={cn(
              chip,
              "bg-primary/10 text-primary",
              confirmed ? "opacity-100" : "opacity-0",
            )}
          >
            <CheckIcon aria-hidden className="size-3" />
            Saved to memory
          </span>
        </span>
      </div>
      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        Interviewing at a design studio, final round on Thursday. Nervous about the portfolio
        review.
      </p>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-(--motion-ease-out)",
          confirmed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex justify-end gap-1.5 pt-1">
            <Button size="sm" tabIndex={-1} type="button" variant="ghost">
              <XIcon aria-hidden />
              Dismiss
            </Button>
            <Button
              className={cn(
                pressing && "translate-y-px bg-[color-mix(in_oklch,var(--primary),black_10%)]",
              )}
              size="sm"
              tabIndex={-1}
              type="button"
            >
              <CheckIcon aria-hidden />
              Save
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function FollowUpCard() {
  return (
    <article className="tn-rise flex flex-col gap-2 rounded-xl border bg-surface px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Sam Rivera</span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[length:var(--text-caption)] font-medium text-accent-soft-foreground">
          Follow-up · Friday
        </span>
      </div>
      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        Ask Sam how the interview went
      </p>
    </article>
  );
}

function TodayPanel() {
  return (
    <section className="tn-rise rounded-xl border bg-surface">
      <div className="flex items-center justify-between border-b px-3.5 py-2.5">
        <span className="text-sm font-medium">Today</span>
        <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
          Friday
        </span>
      </div>
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Sam Rivera</span>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[length:var(--text-caption)] font-medium text-accent-soft-foreground">
            Today
          </span>
        </div>
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
          Ask Sam how the interview went
        </p>
      </div>
    </section>
  );
}

function Answer() {
  return (
    <div className="tn-rise flex flex-col gap-1.5 px-1">
      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        The portfolio review. Sam&rsquo;s final round at the design studio was Thursday, so today is
        a good day to ask how it went.
      </p>
      <p className="font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
        From your note · Tuesday, after coffee
      </p>
    </div>
  );
}

function Composer({
  caret,
  placeholder,
  text,
}: {
  caret: boolean;
  placeholder: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border bg-background">
      <div className="min-h-[4.25rem] px-3 py-2.5 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {text ? text : <span className="text-muted-foreground">{placeholder}</span>}
        {caret ? (
          <span className="tn-caret ml-px inline-block h-[1.1em] w-px translate-y-[0.2em] bg-foreground" />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg border text-muted-foreground">
            <PlusIcon aria-hidden className="size-3.5" />
          </span>
          <span className="hidden text-[length:var(--text-caption)] text-muted-foreground sm:inline">
            Enter to send · Shift + Enter for a new line
          </span>
        </div>
        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-lg transition-colors duration-300",
            text ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowUpIcon aria-hidden className="size-3.5" />
        </span>
      </div>
    </div>
  );
}
