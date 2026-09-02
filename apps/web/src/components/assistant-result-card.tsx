import type { AssistantToolView } from "@/lib/eve/tool-result-view";
import { cn } from "@/lib/utils";

export type CardTone = "confirmed" | "neutral" | "tentative";

/**
 * Trust-weighted surface for a tool-result card. Confirmed saves carry a quiet
 * sage wash (sage = confirmed in the system), logged context stays neutral, and
 * tentative suggestions take a clay wash — so the card's color says how much to
 * trust it before a word is read (DESIGN.md §3, ADR 0004, ADR 0029). Shared by the
 * single-result cards, the interactive review cards, and the grouped summary so
 * the trust palette stays one vocabulary across the assistant surface.
 */
export const CARD_TONE: Record<
  CardTone,
  { surface: string; divider: string; chip: string; label: string }
> = {
  confirmed: {
    surface: "border-primary/20 bg-primary/[0.05]",
    divider: "border-primary/15",
    chip: "bg-primary/15 text-primary",
    label: "text-primary",
  },
  neutral: {
    surface: "border-border bg-card",
    divider: "border-border",
    chip: "bg-secondary text-muted-foreground",
    label: "text-foreground",
  },
  tentative: {
    surface: "border-accent/25 bg-accent-soft/45",
    divider: "border-accent/20",
    chip: "bg-accent/15 text-accent",
    label: "text-accent-soft-foreground",
  },
};

/**
 * What a card is a card *of*, stamped on `data-tool-view`. Almost always a persisted
 * result kind; the two exceptions are calls that have no output to name — a tool call
 * parked on the owner's approval (`input_request`), and a turn stopped for a sign-in
 * the owner has to complete outside the app (`authorization`).
 */
export type ResultCardKind = AssistantToolView["kind"] | "input_request" | "authorization";

export function ResultCard({
  tone,
  icon,
  label,
  footer,
  children,
  isNew,
  kind,
}: {
  tone: CardTone;
  icon?: React.ReactNode;
  label?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  isNew: boolean;
  kind: ResultCardKind;
}) {
  const t = CARD_TONE[tone];

  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3",
        t.surface,
        isNew && "fade-in slide-in-from-bottom-1 animate-in duration-200 ease-(--motion-ease-out)",
      )}
      data-tool-view={kind}
    >
      {icon && label ? (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", t.chip)}
          >
            {icon}
          </span>
          <span className={cn("text-[length:var(--text-small)] font-medium", t.label)}>
            {label}
          </span>
        </div>
      ) : null}
      {children}
      {footer ? <div className={cn("border-t pt-2", t.divider)}>{footer}</div> : null}
    </article>
  );
}

export function Body({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  /** For content whose own line breaks are load-bearing, e.g. `whitespace-pre-line`. */
  className?: string;
  /** So a control elsewhere in the card can point at this text with `aria-describedby`. */
  id?: string;
}) {
  return (
    <p
      className={cn(
        "max-w-[68ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]",
        className,
      )}
      id={id}
    >
      {children}
    </p>
  );
}

/** Sans explanatory caption — copy, not machine facts, so never mono (DESIGN.md §4). */
export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[length:var(--text-caption)] text-muted-foreground">{children}</span>
  );
}
