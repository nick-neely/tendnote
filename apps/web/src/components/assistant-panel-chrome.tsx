import type { ReactNode } from "react";
import { LockIcon, NotebookPenIcon } from "@/components/icons";
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

export const ASSISTANT_UNSCOPED_SUBTITLE =
  "Jot anything you want to remember. Saved privately, reviewed before it becomes memory.";

/** Header copy, most specific first: the person this panel is scoped to, else the notebook. */
export function assistantSubtitleFor(personName?: string): string {
  return personName
    ? `Capturing about ${personName}. Saved and linked to them before review.`
    : ASSISTANT_UNSCOPED_SUBTITLE;
}

/** Shared chip geometry for the header's right-hand affordances. */
export const assistantChipClass =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-[length:var(--text-caption)]";

export function AssistantPanelShell({
  children,
  className,
  ...props
}: { children: ReactNode } & React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "flex h-full min-h-[30rem] flex-col rounded-xl border bg-panel lg:min-h-0",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
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
        <h2 className="font-semibold text-sm">Assistant</h2>
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
export function AssistantComposerShell({ children }: { children: ReactNode }) {
  return <div className="border-t p-3 sm:p-4">{children}</div>;
}

/** The panel before a first turn exists. */
export function AssistantEmptyCapture() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <NotebookPenIcon className="size-5" />
      </span>
      <div className="flex max-w-xs flex-col gap-1.5">
        <p className="font-medium text-sm">Start your notebook</p>
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          Who you talked to, what's going on with them, or something to follow up on.
        </p>
      </div>
    </div>
  );
}
