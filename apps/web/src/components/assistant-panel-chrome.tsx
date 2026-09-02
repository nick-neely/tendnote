import type { ReactNode } from "react";
import { LockIcon } from "@/components/icons";
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
 */
export type AssistantSurface = "bleed" | "panel";

export const ASSISTANT_UNSCOPED_SUBTITLE = "Private, and reviewed before anything is saved.";

/** Header copy, most specific first: the person this panel is scoped to, else the notebook. */
export function assistantSubtitleFor(personName?: string): string {
  return personName
    ? `About ${personName}. Reviewed before anything is saved.`
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
        "flex h-full min-h-0 flex-col bg-panel",
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
        "border-t",
        surface === "panel"
          ? "p-3 sm:p-4"
          : // The phone's flow owns the gutter; the composer owns the distance to
            // the home indicator, which no ancestor can know for it.
            "px-gutter pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
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
