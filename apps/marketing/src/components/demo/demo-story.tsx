"use client";

import { Button } from "@tendnote/ui/button";
import { cn } from "@tendnote/ui/cn";
import { TendnoteMark } from "@tendnote/ui/tendnote-logo";
import Link from "next/link";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import { ArrowRightIcon, ArrowUpIcon, CheckIcon, PlusIcon, RestartIcon } from "@/components/icons";
import { pageTitle, smallText } from "@/components/page-section";
import { StorySteps } from "@/components/story-steps";
import { useReducedMotion } from "@/components/use-reduced-motion";
import { useTypedText } from "@/components/use-typed-text";
import {
  ANSWER_SOURCE,
  ASK_DAY,
  type Day,
  type DayId,
  type DemoAction,
  dayById,
  days,
  demoReducer,
  FOLLOW_UP_TEXT,
  initialDemoState,
  MEMORY_TEXT,
  NOTE_DAY,
  NOTE_TEXT,
  PERSON,
  type Question,
  type QuestionId,
  questionById,
  questions,
  REMINDER_TIME,
  SUGGESTED_DAY,
  steps,
} from "./demo-script";

/*
 * The Marketing Demo: Sam's interview, played by the visitor. The stage is a
 * working copy of the product's notebook with every reply written in advance;
 * each step waits for one action (Send, Approve, Accept, a question, Skip
 * ahead) and the step list revisits any of them. Nothing here fetches,
 * stores, or schedules anything. The page's one authored moment is the time
 * jump: the days roll forward and the reminder lands on a phone. With reduced
 * motion the roll is skipped and the phone is simply there.
 */

const STEPS_LABEL = "Steps in the demo";
const caption = "text-[length:var(--text-caption)] leading-[var(--text-caption-line)]";
const chip = cn(
  "inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
  caption,
);

export function DemoStory() {
  const [state, dispatch] = useReducer(demoReducer, initialDemoState);
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  // After the visitor acts inside the story, focus follows to the next thing to
  // do. Choosing a step from the list leaves focus on the list.
  function act(action: DemoAction) {
    moveFocus.current = action.type !== "go-to";
    dispatch(action);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `state.step` is the trigger; the step's next control is found in the DOM it rendered.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const stage = stageRef.current;
    const next = stage?.querySelector<HTMLElement>("[data-demo-next]");
    if (!stage || !next) return;
    if (!state.arrived) {
      next.focus();
      return;
    }
    // The payoff starts at the top of the stage; on a phone, bring that into
    // view rather than the closing words below the lock screen.
    const top = stage.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight / 2) {
      stage.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }
    next.focus({ preventScroll: true });
  }, [state.step, state.arrived, reduced]);

  const day = dayById(state.day);
  const goTo = (step: number) => act({ type: "go-to", step });
  const restart = () => act({ type: "restart" });

  return (
    <section
      aria-labelledby="demo-title"
      className="mx-auto grid max-w-6xl gap-x-16 gap-y-6 px-gutter pt-8 pb-16 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:pb-24"
    >
      <div className="flex flex-col gap-5 sm:gap-6 lg:sticky lg:top-20 lg:self-start">
        <h1 className={cn(pageTitle, "max-w-[16ch]")} id="demo-title">
          Sam has a big interview on Thursday.
        </h1>
        <p className="max-w-[46ch] text-lg leading-7 text-muted-foreground">
          You hear about it over coffee. Play what Tendnote does with that one sentence, from the
          note to the reminder. Five steps, no account.
        </p>
        <StorySteps
          className="hidden lg:block"
          current={state.step}
          label={STEPS_LABEL}
          onSelect={goTo}
          steps={steps}
        />
        {state.arrived ? null : <DemoControls className="hidden lg:flex" onRestart={restart} />}
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <StorySteps
          className="lg:hidden"
          compact
          current={state.step}
          label={STEPS_LABEL}
          onSelect={goTo}
          steps={steps}
        />
        <div
          // The stage holds one height on desktop from the first step, so Send grows the thread, not the box.
          className="flex scroll-mt-20 flex-col gap-3 rounded-2xl border bg-panel p-3 sm:p-4 lg:min-h-[37rem]"
          ref={stageRef}
        >
          <StageBar
            day={state.arrived ? day.name : state.step >= 3 ? ASK_DAY : NOTE_DAY}
            // The new day shows once the roll has counted up to it.
            delay={state.arrived && !reduced ? "1.15s" : undefined}
          />
          {state.arrived ? (
            <Arrival day={day} onRestart={restart} reduced={reduced} />
          ) : (
            <Notebook
              onAct={act}
              question={state.question}
              reduced={reduced}
              selectedDay={state.day}
              step={state.step}
            />
          )}
        </div>
        {state.arrived ? null : <DemoControls className="lg:hidden" onRestart={restart} />}
      </div>

      <p aria-live="polite" className="sr-only">
        {state.announcement}
      </p>
    </section>
  );
}

function DemoControls({ className, onRestart }: { className?: string; onRestart: () => void }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button asChild size="lg" variant="outline">
        <Link href="/pricing">View pricing</Link>
      </Button>
      <Button onClick={onRestart} size="lg" type="button" variant="ghost">
        <RestartIcon aria-hidden />
        Restart the story
      </Button>
    </div>
  );
}

function StageBar({ day, delay }: { day: string; delay?: string }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="flex items-center gap-2 text-sm font-medium">
        <span aria-hidden className="size-2 rounded-full bg-primary" />
        Assistant
      </span>
      <span
        className="tn-rise font-mono text-xs text-muted-foreground"
        key={day}
        style={delay ? { animationDelay: delay } : undefined}
      >
        {day}
      </span>
    </div>
  );
}

function Notebook({
  onAct,
  question,
  reduced,
  selectedDay,
  step,
}: {
  onAct: (action: DemoAction) => void;
  question: QuestionId;
  reduced: boolean;
  selectedDay: DayId;
  step: number;
}) {
  const day = dayById(selectedDay);
  const typed = useTypedText(NOTE_TEXT, step === 0, reduced);

  return (
    <div className="flex flex-1 flex-col gap-3">
      {step === 0 ? <EmptyNotebook /> : null}
      <Thread day={day} onAct={onAct} question={questionById(question)} step={step} />
      <NotebookInput day={day} onAct={onAct} step={step} typed={typed} />
    </div>
  );
}

/** Everything the visitor has done so far, oldest first, anchored to the composer like a chat. */
function Thread({
  day,
  onAct,
  question,
  step,
}: {
  day: Day;
  onAct: (action: DemoAction) => void;
  question: Question;
  step: number;
}) {
  return (
    <div className="mt-auto flex flex-col gap-3">
      {step >= 1 ? <UserTurn text={NOTE_TEXT} /> : null}
      {step >= 1 ? (
        <MemoryCard
          cited={step >= 4}
          onApprove={() => onAct({ type: "approve" })}
          resolved={step >= 2}
        />
      ) : null}
      {step >= 2 ? (
        <FollowUpCard
          day={day}
          onAccept={(choice) => onAct({ type: "schedule", day: choice })}
          resolved={step >= 3}
        />
      ) : null}
      {step >= 3 ? <DayDivider day={ASK_DAY} /> : null}
      {step >= 4 ? <UserTurn text={question.text} /> : null}
      {step >= 4 ? <Answer text={question.answer(day)} /> : null}
    </div>
  );
}

/** What sits under the thread: the composer, the supplied questions, or Skip ahead. */
function NotebookInput({
  day,
  onAct,
  step,
  typed,
}: {
  day: Day;
  onAct: (action: DemoAction) => void;
  step: number;
  typed: string;
}) {
  if (step === 0) return <Composer onSend={() => onAct({ type: "send" })} text={typed} />;
  if (step === 4) return <SkipAhead day={day} onJump={() => onAct({ type: "jump" })} />;
  if (step < 3) return <Composer placeholder="What did they tell you?" />;
  return (
    <>
      <QuestionPicker onAsk={(choice) => onAct({ type: "ask", question: choice })} />
      <Composer placeholder="Ask what you remember" />
    </>
  );
}

/**
 * The notebook before the first note, as the product shows it: quiet, with the
 * day and one line on what to do. On a phone the step text above already says
 * this, and Send needs the room.
 */
function EmptyNotebook() {
  return (
    <div className="hidden flex-1 flex-col items-center justify-center gap-3 px-6 text-center lg:flex">
      <TendnoteMark className="size-9 opacity-80" />
      <p className="font-display text-[1.5rem] leading-8 font-semibold">
        Tuesday, just after coffee
      </p>
      <p className={cn("max-w-[36ch] text-muted-foreground", smallText)}>
        Your note is going in below, the way you would write it. Press Send to see what Tendnote
        does with it.
      </p>
    </div>
  );
}

/** Where the thread crosses into the next day, so the question reads as recall. */
function DayDivider({ day }: { day: string }) {
  return (
    <div className="tn-rise flex items-center gap-3 py-1">
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className={cn("font-mono text-muted-foreground", caption)}>{day}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="tn-rise flex justify-end">
      <p className="max-w-[88%] rounded-xl border bg-background px-3 py-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {text}
      </p>
    </div>
  );
}

/** A suggestion card in the product's review vocabulary: clay while tentative, sage once kept. */
function ReviewCard({
  children,
  cited = false,
  resolved,
}: {
  children: React.ReactNode;
  cited?: boolean;
  resolved: boolean;
}) {
  return (
    <article
      className={cn(
        "tn-rise flex flex-col gap-2.5 rounded-xl border px-3.5 py-3 transition-[background-color,border-color,box-shadow] duration-500 ease-(--motion-ease-out)",
        resolved ? "border-border bg-surface" : "border-accent/25 bg-accent-soft/45",
        cited &&
          "border-primary/45 shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary),transparent_85%)]",
      )}
    >
      {children}
    </article>
  );
}

function PendingChip({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn(chip, "bg-accent-soft text-accent-soft-foreground")}>
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {children}
    </span>
  );
}

function ResolvedChip({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn(chip, "bg-primary/15 text-primary")}>
      <CheckIcon aria-hidden className="size-3" />
      {children}
    </span>
  );
}

function CardFooter({ children }: { children: React.ReactNode }) {
  return <p className={cn("text-muted-foreground", caption)}>{children}</p>;
}

function MemoryCard({
  cited,
  onApprove,
  resolved,
}: {
  cited: boolean;
  onApprove: () => void;
  resolved: boolean;
}) {
  return (
    <ReviewCard cited={cited} resolved={resolved}>
      {resolved ? (
        <ResolvedChip>Saved to memory</ResolvedChip>
      ) : (
        <PendingChip>Suggested</PendingChip>
      )}
      <p className={smallText}>
        <span className="text-muted-foreground">
          {resolved ? PERSON : `Suggested for ${PERSON}`}:{" "}
        </span>
        {MEMORY_TEXT}
      </p>
      {resolved ? (
        <CardFooter>
          {cited
            ? "Confirmed fact · the source of Eve's answer below"
            : `Confirmed fact · ${PERSON}, kept in your notebook`}
        </CardFooter>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <CardFooter>Tentative. Not saved until you approve.</CardFooter>
          <Button
            aria-label={`Approve suggestion for ${PERSON}`}
            data-demo-next
            onClick={onApprove}
            size="sm"
            type="button"
          >
            <CheckIcon aria-hidden />
            Approve
          </Button>
        </div>
      )}
    </ReviewCard>
  );
}

function FollowUpCard({
  day,
  onAccept,
  resolved,
}: {
  day: Day;
  onAccept: (day: DayId) => void;
  resolved: boolean;
}) {
  const [choice, setChoice] = useState<DayId>(day.id);
  const name = useId();

  if (resolved) {
    return (
      <ReviewCard resolved>
        <ResolvedChip>Reminder set</ResolvedChip>
        <p className={smallText}>
          <span className="text-muted-foreground">{PERSON}: </span>
          {FOLLOW_UP_TEXT}
        </p>
        <ul className={cn("flex flex-col gap-1 border-t pt-2.5", smallText)}>
          <ResurfaceRow label="On Today" value={day.name} />
          <ResurfaceRow label="In the Daily Brief" value={`${day.name} morning`} />
          <ResurfaceRow
            label="As a reminder"
            value={`${day.name}, ${REMINDER_TIME}, if reminders are on`}
          />
        </ul>
        <CardFooter>Active reminder · {PERSON}, added to your follow-ups</CardFooter>
      </ReviewCard>
    );
  }

  return (
    <ReviewCard resolved={false}>
      <PendingChip>Suggested follow-up</PendingChip>
      <p className={smallText}>
        <span className="text-muted-foreground">Suggested follow-up for {PERSON}: </span>
        {FOLLOW_UP_TEXT}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className={cn("mb-2 font-medium text-muted-foreground", caption)}>
          Check in on
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {days.map((option) => (
            <label
              className="cursor-pointer rounded-full border bg-background px-3 py-1 text-[length:var(--text-small)] leading-[var(--text-small-line)] transition-colors duration-150 hover:border-ring has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-3 has-focus-visible:ring-ring"
              key={option.id}
            >
              <input
                checked={choice === option.id}
                className="sr-only"
                data-demo-next={choice === option.id ? "" : undefined}
                name={name}
                onChange={() => setChoice(option.id)}
                type="radio"
                value={option.id}
              />
              {option.label}
              {option.id === SUGGESTED_DAY ? (
                <span className="opacity-75"> · suggested</span>
              ) : null}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center justify-between gap-3">
        <CardFooter>Tentative. No reminder until you accept.</CardFooter>
        <Button
          aria-label={`Accept suggested follow-up for ${PERSON}`}
          onClick={() => onAccept(choice)}
          size="sm"
          type="button"
        >
          <CheckIcon aria-hidden />
          Accept
        </Button>
      </div>
    </ReviewCard>
  );
}

function ResurfaceRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </li>
  );
}

function Answer({ text }: { text: string }) {
  return (
    <div className="tn-rise flex flex-col gap-2 px-1">
      <span className="text-sm font-medium">Eve</span>
      <p className={smallText}>{text}</p>
      <p className={cn("flex items-center gap-1.5 font-mono text-muted-foreground", caption)}>
        <ArrowUpIcon aria-hidden className="size-3" />
        {ANSWER_SOURCE}
      </p>
    </div>
  );
}

function QuestionPicker({ onAsk }: { onAsk: (question: QuestionId) => void }) {
  return (
    <div className="tn-rise flex flex-col gap-2 px-1">
      <p className={cn("font-medium text-muted-foreground", caption)} id="demo-questions">
        Pick a question to ask
      </p>
      <ul aria-labelledby="demo-questions" className="flex flex-col items-start gap-1.5">
        {questions.map((question, index) => (
          <li key={question.id}>
            <button
              className="rounded-xl border bg-background px-3 py-1.5 text-left text-[length:var(--text-small)] leading-[var(--text-small-line)] outline-none transition-colors duration-150 hover:border-ring hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring"
              data-demo-next={index === 0 ? "" : undefined}
              onClick={() => onAsk(question.id)}
              type="button"
            >
              {question.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkipAhead({ day, onJump }: { day: Day; onJump: () => void }) {
  return (
    <div className="tn-rise flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-background px-3.5 py-3">
      <p className={cn("text-muted-foreground", smallText)}>{day.later}, on the day you picked.</p>
      <Button data-demo-next onClick={onJump} type="button">
        Skip ahead to {day.name}
        <ArrowRightIcon aria-hidden />
      </Button>
    </div>
  );
}

function Composer({
  onSend,
  placeholder,
  text,
}: {
  onSend?: () => void;
  placeholder?: string;
  text?: string;
}) {
  return (
    <div className="rounded-xl border bg-background">
      <p className="min-h-[4.25rem] px-3 py-2.5 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {text !== undefined ? text : <span className="text-muted-foreground">{placeholder}</span>}
        {onSend ? (
          <span
            aria-hidden
            className="tn-caret ml-px inline-block h-[1.1em] w-px translate-y-[0.2em] bg-foreground"
          />
        ) : null}
      </p>
      <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
        <span
          aria-hidden
          className="inline-flex size-7 items-center justify-center rounded-lg border text-muted-foreground"
        >
          <PlusIcon aria-hidden className="size-3.5" />
        </span>
        {onSend ? (
          <Button data-demo-next onClick={onSend} size="sm" type="button">
            Send
            <ArrowUpIcon aria-hidden />
          </Button>
        ) : (
          <span
            aria-hidden
            className="inline-flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <ArrowUpIcon aria-hidden className="size-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}

/*
 * The time jump and the payoff. The roll counts the days from Wednesday to the
 * day the visitor picked, then the phone rises and the reminder drops onto its
 * lock screen. The roll is decorative and skipped with reduced motion; the
 * closing words carry everything the phone shows.
 */
function Arrival({
  day,
  onRestart,
  reduced,
}: {
  day: Day;
  onRestart: () => void;
  reduced: boolean;
}) {
  // Inline delays would outrank the reduced-motion floor, so they are only set with motion.
  const after = (delay: string) => (reduced ? undefined : { animationDelay: delay });

  return (
    <div className="relative grid flex-1 content-center items-center gap-8 px-1 py-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-10 sm:px-4 sm:py-6">
      {reduced ? null : <DayRoll day={day} />}
      <LockScreen day={day} dropStyle={after("1.6s")} style={after("1.15s")} />
      <div
        className="tn-rise flex flex-col gap-4 outline-none"
        data-demo-next
        style={after("1.9s")}
        tabIndex={-1}
      >
        <h2 className="font-display text-[1.75rem] leading-[1.15] font-semibold text-balance sm:text-[2rem]">
          {FOLLOW_UP_TEXT}.
        </h2>
        <p className="max-w-[44ch] text-muted-foreground">
          You wrote one sentence on {NOTE_DAY} and asked about it on {ASK_DAY}. {day.later}, at{" "}
          {REMINDER_TIME} on {day.name}, Tendnote hands it back as the one thing worth doing today.
          That is the whole loop.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/pricing">View pricing</Link>
          </Button>
          <Button onClick={onRestart} size="lg" type="button" variant="ghost">
            <RestartIcon aria-hidden />
            Restart the story
          </Button>
        </div>
        <p className={cn("text-muted-foreground", smallText)}>
          One plan. A full refund within fourteen days of your first payment if it is not for you.
        </p>
      </div>
    </div>
  );
}

function DayRoll({ day }: { day: Day }) {
  const distance = `${-(day.roll.length - 1) * 1.2}em`;
  return (
    <div
      aria-hidden
      className="tn-roll-out pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-panel"
    >
      <div className="h-[1.2em] overflow-hidden font-display text-[2.75rem] font-semibold sm:text-[3.5rem]">
        <div
          className="tn-roll flex flex-col text-center"
          style={{ "--tn-roll-distance": distance } as React.CSSProperties}
        >
          {day.roll.map((name) => (
            <span className="block h-[1.2em] leading-[1.2em]" key={name}>
              {name}
            </span>
          ))}
        </div>
      </div>
      <p className={cn("font-mono text-muted-foreground", caption)}>{day.later}</p>
    </div>
  );
}

/** A phone's lock screen, drawn rather than photographed. Decorative: the closing words say it. */
function LockScreen({
  day,
  dropStyle,
  style,
}: {
  day: Day;
  dropStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className="tn-phone-in relative mx-auto h-[29rem] w-[14.5rem] shrink-0 overflow-hidden rounded-[2.6rem] border-[7px] border-[oklch(0.22_0.012_145)] dark:border-[oklch(0.34_0.012_145)] bg-[oklch(0.34_0.055_145)] text-[oklch(0.98_0_0)] shadow-[0_28px_48px_-28px_rgb(0_0_0/0.55)]"
      style={style}
    >
      <div className="mx-auto mt-2.5 h-5 w-[4.5rem] rounded-full bg-[oklch(0.12_0.01_145)]" />
      <div className="mt-7 flex flex-col items-center gap-0.5">
        <span className="text-sm font-medium opacity-85">{day.name}</span>
        <span className="font-display text-[3.75rem] leading-none font-semibold tabular-nums">
          {REMINDER_TIME.replace(" AM", "")}
        </span>
      </div>
      <div
        className="tn-drop mx-2.5 mt-8 flex flex-col gap-1 rounded-2xl bg-background px-3 py-2.5 text-foreground shadow-[0_10px_24px_-14px_rgb(0_0_0/0.6)]"
        style={dropStyle}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[length:var(--text-caption)] font-medium">
            <TendnoteMark className="size-3.5" />
            Tendnote
          </span>
          <span className="text-[length:var(--text-caption)] opacity-60">now</span>
        </div>
        <p className="text-[0.8125rem] leading-[1.15rem] font-semibold">{FOLLOW_UP_TEXT}</p>
        <p className="text-[0.75rem] leading-4 opacity-70">Follow-up · {PERSON}</p>
      </div>
      <div className="absolute inset-x-0 bottom-2 mx-auto h-1 w-24 rounded-full bg-[oklch(0.98_0_0)]/70" />
    </div>
  );
}
