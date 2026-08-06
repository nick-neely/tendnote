import type { ReactNode } from "react";

/**
 * The step marker. Caption size in a hairline square, and deliberately quiet:
 * the heading beside it carries the meaning, and nothing here is a score. Not
 * mono, which DESIGN.md keeps for machine facts rather than for looking precise.
 */
function StepMarker({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border text-[length:var(--text-caption)] leading-none text-muted-foreground"
    >
      {children}
    </span>
  );
}

/**
 * One leg of the import round trip.
 *
 * Numbered because the sequence is the information here: this is a trip out to
 * another app and back, and an owner who cannot see the whole shape of it will
 * not trust the first step. Everywhere else in the product, numbered sections
 * would be grammar nobody chose.
 */
export function ContextFactImportStep({
  children,
  description,
  headingId,
  step,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  headingId: string;
  step: number;
  title: string;
}) {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <StepMarker>{step}</StepMarker>
          <h2
            className="min-w-0 text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
            id={headingId}
          >
            {title}
          </h2>
        </div>
        {description ? (
          <p className="max-w-[65ch] break-words pl-7 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3 pl-7">{children}</div>
    </section>
  );
}
