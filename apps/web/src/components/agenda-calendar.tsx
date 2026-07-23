"use client";

import Link from "next/link";
import * as React from "react";
import type { DayButton } from "react-day-picker";
import {
  ArrowUpRightIcon,
  CakeIcon,
  CalendarDotsIcon,
  LockIcon,
  NotebookPenIcon,
} from "@/components/icons";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AGENDA_TONE_META,
  type AgendaTone,
  agendaDayKey,
  agendaTone,
  dayKeyFromDate,
  distinctTones,
  formatAgendaDay,
  formatAgendaRange,
  formatAgendaWeekday,
  labelAgendaDue,
  labelAgendaKind,
  labelAgendaTrust,
  labelSensitivity,
  labelSourceGrounding,
  utcDayDate,
} from "@/lib/eve/agenda-format";
import type { RelationshipAgendaCandidateView } from "@/lib/eve/tool-result-view";
import { cn } from "@/lib/utils";

type Candidate = RelationshipAgendaCandidateView;
type AgendaWindow = { start: string; end: string };

const KIND_ICON = {
  birthday: CakeIcon,
  due_followup: CalendarDotsIcon,
  suggested_followup: CalendarDotsIcon,
  review_item: NotebookPenIcon,
  recent_context: NotebookPenIcon,
  semantic_context: NotebookPenIcon,
} satisfies Record<Candidate["kind"], typeof CakeIcon>;

/**
 * Spreads the relationship agenda across a compact month so the user can see when
 * things line up instead of scrolling a flat list. Dated items (birthdays, due and
 * suggested follow-ups, recently logged context) sit on their calendar day with a
 * trust-toned marker and open a popover on click; undated items the calendar can't
 * place (review queue, related context) keep a short "no date" rail below so
 * nothing is hidden. Color carries trust, the kind icon carries type, and every
 * item is spelled out in text — the encoding never rests on color alone.
 */
export function AgendaCalendar({
  candidates,
  window = null,
}: {
  candidates: Candidate[];
  window?: AgendaWindow | null;
}) {
  const dated: Array<Candidate & { dayKey: string }> = [];
  const undated: Candidate[] = [];

  for (const candidate of candidates) {
    const dayKey = candidate.dueAt ? agendaDayKey(candidate.dueAt) : null;
    if (dayKey) {
      dated.push({ ...candidate, dayKey });
    } else {
      undated.push(candidate);
    }
  }

  // Nothing to place on a grid — don't show an empty month; the rail carries it.
  if (dated.length === 0) {
    return (
      <div className="px-3.5 pt-3 pb-3.5">
        <AgendaRail candidates={undated} standalone />
      </div>
    );
  }

  const byDay = new Map<string, Candidate[]>();
  for (const candidate of dated) {
    const bucket = byDay.get(candidate.dayKey);
    if (bucket) {
      bucket.push(candidate);
    } else {
      byDay.set(candidate.dayKey, [candidate]);
    }
  }

  // The requested window (e.g. "next week") becomes a highlighted band. We open
  // to its month *only when it overlaps the data* — so the user lands on the span
  // they asked about with their items in view, and can still page elsewhere. When
  // the window sits far from every item (e.g. the model resolved the date wrong),
  // we anchor to the items instead so the calendar never opens on an empty month.
  const windowFrom = window ? utcDayDate(window.start) : null;
  const windowTo = window ? utcDayDate(window.end) : null;
  const hasWindow = windowFrom !== null && windowTo !== null && windowFrom <= windowTo;
  const rangeLabel = window && hasWindow ? formatAgendaRange(window.start, window.end) : null;

  const earliest = dated.reduce((min, candidate) =>
    candidate.dayKey < min.dayKey ? candidate : min,
  );
  const latestKey = dated.reduce(
    (max, candidate) => (candidate.dayKey > max ? candidate.dayKey : max),
    earliest.dayKey,
  );
  const windowOverlapsData =
    hasWindow &&
    dayKeyFromDate(windowTo) >= earliest.dayKey &&
    dayKeyFromDate(windowFrom) <= latestKey;
  const anchor = windowOverlapsData ? windowFrom : new Date(earliest.dueAt as string);
  const defaultMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));

  const windowModifiers = hasWindow
    ? { window: { from: windowFrom, to: windowTo }, windowStart: windowFrom, windowEnd: windowTo }
    : undefined;

  return (
    <div className="flex flex-col gap-3 px-3 pt-2 pb-3.5">
      {/* Context lets each day cell read its own bucket without prop drilling
          through react-day-picker's component slot. */}
      <AgendaContext.Provider value={byDay}>
        <Calendar
          // `mode="single"` makes days interactive so react-day-picker renders
          // them through the DayButton slot we override; selection itself is
          // never wired up (the day cell is a popover trigger, not a picker).
          className="w-full bg-transparent p-0 [--cell-size:--spacing(8)]"
          classNames={{
            month_caption: "flex h-(--cell-size) w-full items-center justify-center",
            caption_label:
              "font-medium text-[length:var(--text-small)] text-foreground select-none",
            weekday:
              "flex-1 text-[length:var(--text-caption)] font-normal text-muted-foreground select-none",
            // Fixed-height rows keep the month compact in chat; the default
            // aspect-square cell stretches tall at full panel width. No per-cell
            // rounding so the window band reads as one continuous span.
            week: "mt-1 flex w-full",
            day: "relative h-9 flex-1 p-0",
            today: "",
          }}
          components={{ DayButton: AgendaDayButton }}
          defaultMonth={defaultMonth}
          modifiers={windowModifiers}
          modifiersClassNames={{
            window: "bg-primary/[0.07]",
            windowStart: "rounded-l-(--cell-radius)",
            windowEnd: "rounded-r-(--cell-radius)",
          }}
          mode="single"
          showOutsideDays
          timeZone="UTC"
        />
      </AgendaContext.Provider>
      {rangeLabel ? (
        <p className="flex items-center gap-1.5 px-1 text-[length:var(--text-caption)] text-muted-foreground">
          <span
            aria-hidden
            className="h-2.5 w-5 shrink-0 rounded-full bg-primary/15 ring-1 ring-primary/25 ring-inset"
          />
          The dates you asked about · {rangeLabel}
        </p>
      ) : null}
      <AgendaLegend candidates={candidates} />
      {undated.length > 0 ? (
        <>
          <div className="border-border/70 border-t" />
          <AgendaRail candidates={undated} />
        </>
      ) : null}
    </div>
  );
}

// react-day-picker renders DayButton through a component slot, so the per-day
// bucket can't be passed as a prop — it travels by context instead.
const AgendaContext = React.createContext<Map<string, Candidate[]>>(new Map());

function AgendaDayButton({ day, modifiers }: React.ComponentProps<typeof DayButton>) {
  const byDay = React.useContext(AgendaContext);
  const items = byDay.get(dayKeyFromDate(day.date)) ?? [];
  const dayNumber = day.date.getUTCDate();

  // Empty day: a quiet number, not a control. Keeps the grid airy and keeps the
  // tab order down to the days that actually carry something.
  if (items.length === 0) {
    return (
      <span
        className={cn(
          "flex size-full items-center justify-center text-[length:var(--text-small)] text-muted-foreground/70 tabular-nums",
          modifiers.outside && "text-muted-foreground/35",
          modifiers.today && "font-medium text-foreground",
        )}
      >
        {dayNumber}
      </span>
    );
  }

  const tones = distinctTones(items);

  return (
    <Popover>
      <PopoverTrigger
        aria-label={dayAriaLabel(day.date, items)}
        className={cn(
          "flex size-full flex-col items-center justify-center gap-1 rounded-(--cell-radius) text-[length:var(--text-small)] text-foreground tabular-nums transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary",
          modifiers.outside && "text-muted-foreground",
          modifiers.today && "font-semibold",
        )}
        type="button"
      >
        <span className="leading-none">{dayNumber}</span>
        <span aria-hidden className="flex h-1.5 items-center gap-0.5">
          {tones.map((tone) => (
            <ToneMarker key={tone} tone={tone} />
          ))}
        </span>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 gap-0 p-0" sideOffset={6}>
        <div className="border-border/70 border-b px-3 py-2">
          <p className="font-medium text-[length:var(--text-small)] text-foreground">
            {formatAgendaWeekday(day.date)}
          </p>
        </div>
        <div className="flex max-h-72 flex-col divide-y divide-border/70 overflow-auto">
          {items.map((item, index) => (
            <AgendaItem candidate={item} key={agendaItemKey(item, index)} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ToneMarker({ tone }: { tone: AgendaTone }) {
  const meta = AGENDA_TONE_META[tone];
  return (
    <span
      className={cn(
        "size-1.5 shrink-0",
        meta.dot,
        meta.marker === "disc" && "rounded-full",
        meta.marker === "diamond" && "rotate-45 rounded-[1px]",
        meta.marker === "ring" && "rounded-full",
      )}
    />
  );
}

function AgendaLegend({ candidates }: { candidates: Candidate[] }) {
  const tones = distinctTones(candidates);
  if (tones.length < 2) {
    return null;
  }
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
      {tones.map((tone) => (
        <li
          className="flex items-center gap-1.5 text-[length:var(--text-caption)] text-muted-foreground"
          key={tone}
        >
          <ToneMarker tone={tone} />
          {AGENDA_TONE_META[tone].label}
        </li>
      ))}
    </ul>
  );
}

/** The "no date" rail: items the calendar can't place, still fully visible. */
function AgendaRail({
  candidates,
  standalone = false,
}: {
  candidates: Candidate[];
  standalone?: boolean;
}) {
  if (candidates.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-1 font-medium text-[length:var(--text-caption)] text-muted-foreground uppercase tracking-wide">
        {standalone ? "Relationship agenda" : "No date"}
      </h3>
      <div className="flex flex-col divide-y divide-border/70">
        {candidates.map((candidate, index) => (
          <AgendaItem candidate={candidate} key={agendaItemKey(candidate, index)} />
        ))}
      </div>
    </section>
  );
}

/** One candidate, shared by the day popover and the rail. */
function AgendaItem({ candidate }: { candidate: Candidate }) {
  const Icon = KIND_ICON[candidate.kind];
  const tone = AGENDA_TONE_META[agendaTone(candidate.kind)];
  const href = candidate.personId ? `/people/${candidate.personId}` : null;
  const personLabel = candidate.personDisplayName ?? "Relationship context";
  const isRestricted = candidate.sensitivity === "restricted";

  const caption = [
    labelAgendaTrust(candidate.trustLevel),
    labelSensitivity(candidate.sensitivity),
    candidate.visibilityLabel,
    candidate.dueAt ? labelAgendaDue(candidate.kind, formatAgendaDay(candidate.dueAt)) : null,
    labelSourceGrounding(candidate.sourceRefs),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("flex flex-col gap-1 px-3 py-2.5", isRestricted && "bg-secondary/50")}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon aria-hidden className={cn("size-3.5 shrink-0", tone.text)} />
          {href ? (
            <Link
              className="inline-flex min-w-0 items-center gap-0.5 truncate font-medium text-foreground underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={href}
            >
              <span className="truncate">{personLabel}</span>
              <ArrowUpRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            </Link>
          ) : (
            <span className="truncate font-medium text-foreground">{personLabel}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {isRestricted ? (
            <LockIcon className="size-3 text-muted-foreground" aria-label="Restricted" />
          ) : null}
          <span className="rounded-full border px-1.5 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
            {labelAgendaKind(candidate.kind)}
          </span>
        </span>
      </div>
      <p className="text-pretty text-[length:var(--text-small)] text-foreground leading-[var(--text-small-line)]">
        {candidate.title}
      </p>
      <p className="max-w-[60ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        {candidate.reason}
      </p>
      <p className="text-[length:var(--text-caption)] text-muted-foreground">{caption}</p>
    </div>
  );
}

function dayAriaLabel(date: Date, items: Candidate[]): string {
  const count = items.length === 1 ? "1 item" : `${items.length} items`;
  const titles = items
    .map((item) => (item.visibilityLabel ? `${item.title} (${item.visibilityLabel})` : item.title))
    .join("; ");
  return `${formatAgendaWeekday(date)}, ${count}: ${titles}`;
}

function agendaItemKey(candidate: Candidate, index: number): string {
  const source = candidate.sourceRefs[0];
  return source ? `${source.kind}:${source.id}` : `${candidate.kind}:${candidate.rank}:${index}`;
}
