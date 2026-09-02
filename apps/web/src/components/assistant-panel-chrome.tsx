import type { ReactNode } from "react";
import { BugIcon, LockIcon } from "@/components/icons";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

/**
 * The assistant panel's static chrome — the parts that carry no owner data and
 * no conversation state: the panel shell, its header copy, the pre-first-turn
 * empty state, and the composer's padding well.
 *
 * It lives apart from `assistant-panel.tsx` so the dashboard's reserve
 * (`dashboard-reserve.tsx`) and the live panel render the *same* markup rather
 * than two hand-matched copies. A reserve that duplicates structure drifts as
 * the panel changes, and the drift shows up as a layout shift the moment the
 * panel replaces it.
 */

/**
 * Where the panel is standing.
 *
 * `panel` is the dashboard's working column: a bordered card among other cards.
 * `bleed` is the phone's focused flow, which already has a full-screen header
 * and gutter of its own — a bordered card inside it was a card inside a sheet
 * under two stacked titles, which is the nesting DESIGN.md rules out. In bleed
 * the panel drops its own header and border and simply fills what it is given.
 * `page` is `/assistant`, where the transcript *is* the canvas: it sits on the
 * page background rather than on `panel` (the conversation rail beside it is the
 * panel), owns no header of its own — the page holds one — and its composer is
 * pinned to the bottom of a column that is already the right width.
 */
export type AssistantSurface = "bleed" | "page" | "panel";

/**
 * The reassurance line under "Assistant".
 *
 * It used to open with "Private.", which put the word twice in one header - once
 * here and once in the chip beside it. The chip is the more scannable of the two
 * and it is the one that stays, so the line carries only the half the chip
 * cannot: what happens to what you say.
 */
export const ASSISTANT_UNSCOPED_SUBTITLE = "Nothing is saved without your review.";

/** Header copy, most specific first: the person this panel is scoped to, else the notebook. */
export function assistantSubtitleFor(personName?: string): string {
  return personName
    ? `About ${personName}. Nothing is saved without your review.`
    : ASSISTANT_UNSCOPED_SUBTITLE;
}

/** Shared chip geometry for the header's right-hand affordances. */
export const assistantChipClass =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-[length:var(--text-caption)]";

export function AssistantPanelShell({
  children,
  className,
  surface = "panel",
  ...props
}: { children: ReactNode; surface?: AssistantSurface } & React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col",
        surface === "page" ? "bg-transparent" : "bg-panel",
        surface === "panel" && "min-h-[30rem] rounded-xl border lg:min-h-0",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

/**
 * The assistant's mark is one 8px sage dot before its name. No avatar, no
 * sparkle, no robot — the identity here is typographic, and the dot is the
 * smallest thing that can carry it (DESIGN.md §2).
 */
export function AssistantMark() {
  return <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />;
}

export function AssistantPanelHeader({
  actions,
  subtitle,
}: {
  actions: ReactNode;
  subtitle: string;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="flex items-center gap-2 font-semibold text-sm">
          <AssistantMark />
          Assistant
        </h2>
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {subtitle}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );
}

export function AssistantPrivateChip() {
  return (
    <span className={cn(assistantChipClass, "bg-secondary text-muted-foreground")}>
      <LockIcon aria-hidden className="size-3" />
      Private
    </span>
  );
}

/** The composer's padding well, so the reserve and the live composer sit identically. */
export function AssistantComposerShell({
  children,
  surface = "panel",
}: {
  children: ReactNode;
  surface?: AssistantSurface;
}) {
  return (
    <div
      className={cn(
        surface === "panel" && "border-t p-3 sm:p-4",
        // The phone's flow owns the gutter; the composer owns the distance to
        // the home indicator, which no ancestor can know for it.
        surface === "bleed" &&
          "border-t px-gutter pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        // On the page the composer is not a footer under a rule: it is the last
        // thing in a column that already has edges, and a hairline across the
        // canvas there would cut the transcript off from the box the reader is
        // about to type into. The column owns the horizontal inset, and — unlike
        // the phone sheet — the page's own height already stops above the mobile
        // bottom bar, which is what holds the safe area open.
        surface === "page" && "pt-2 pb-4",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The panel before a first turn exists: a question, one line of reassurance, and
 * whatever the calendar has to suggest.
 *
 * No icon tile. A 40px glyph above two lines of text is decoration standing
 * where the first thing to read should be, and it made the empty panel look like
 * a feature announcement rather than an invitation to write.
 */
export function AssistantEmptyCapture({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <div className="flex max-w-xs flex-col gap-1.5">
        <p className="font-medium text-base">What do you want to remember?</p>
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          Who you talked to, what's going on with them, or something to follow up on.
        </p>
      </div>
      {children}
    </div>
  );
}

/**
 * The same invitation at page scale, sitting directly above the composer rather
 * than centred in a panel.
 *
 * The question is an `<h2>` here because on `/assistant` it is the first real
 * heading under the destination's own title, and it is the largest type on the
 * screen for the same reason the composer is the widest control: before a
 * conversation exists there is nothing else to look at.
 *
 * It renders *outside* the transcript region, immediately above the composer, so
 * that the greeting, the box, and the chips are one block between two equally
 * growing spacers - which is what makes the group centred rather than the
 * composer alone. With the greeting inside the transcript region the centred
 * thing was the composer, and the group it belongs to sat visibly high.
 */
export function AssistantPageGreeting() {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2 pb-5 text-center">
      <h2 className="font-semibold text-[length:var(--text-h2)] leading-[var(--text-h2-line)]">
        What do you want to remember?
      </h2>
      <p className="max-w-[52ch] text-balance text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        Who you talked to, what's going on with them, or something to follow up on.
      </p>
    </div>
  );
}

/**
 * A resumed thread while its durable stream replays.
 *
 * Shaped like the two turns that are about to land — a short user bubble on the
 * right, an activity line and three text lines on the left — rather than a
 * spinner, so the transcript arrives into geometry that is already there
 * (DESIGN.md §Loading). It is `aria-hidden` and announced by the region's own
 * `aria-busy`: the shapes mean nothing read aloud.
 */
export function AssistantResumeSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6 py-2">
      <div className="flex justify-end">
        <div className="h-9 w-2/5 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="h-4 w-[11ch] animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

/**
 * A thread whose Eve session has ended, in place of the composer.
 *
 * A plain fact and a way forward, not an error: nothing broke, the transcript
 * above is still entirely readable, and the only thing that is gone is the
 * ability to add to it. No destructive colour, no alert role — this is the
 * expected end of a 30-day session (ADR 0238), and the one thing it must never
 * do is leave a composer on screen that would fail on submit.
 */
export function AssistantEndedNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        This conversation has ended. Older threads stay readable but can't be continued.
      </p>
      {children}
    </div>
  );
}

/**
 * The turn trace is a developer diagnostic, not a product affordance: it is
 * absent from production builds entirely rather than hidden behind a flag.
 */
export const ASSISTANT_DEBUG_AVAILABLE = process.env.NODE_ENV !== "production";

/**
 * The trace toggle, shared by the dashboard panel's header and the Assistant
 * page's, so the two cannot drift into two different-looking dev controls.
 *
 * Both `aria-pressed:` and `data-[state=on]:` are spelled out so the pressed
 * fill beats the Toggle base's own rule for each - they land at equal
 * specificity, so leaving either to source order is a coin flip.
 */
export function AssistantDebugToggle({
  onPressedChange,
  pressed,
}: {
  onPressedChange: () => void;
  pressed: boolean;
}) {
  return (
    <Toggle
      aria-label="Toggle debug trace"
      className={cn(
        assistantChipClass,
        "h-auto min-w-0 bg-secondary text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        "aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:bg-foreground data-[state=on]:text-background",
        "data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background",
      )}
      onPressedChange={onPressedChange}
      pressed={pressed}
    >
      <BugIcon aria-hidden className="size-3" />
      Debug
    </Toggle>
  );
}
