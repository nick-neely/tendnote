"use client";

import { contextFactCategoryLabel } from "@tendnote/domain/context-facts";
import {
  HOUSEHOLD_CONTEXT_RECONCILE_BODY,
  type HouseholdContextActorIdentity,
  type HouseholdContextReconcileChoice,
  type HouseholdContextReconciliation,
  householdContextActorLabel,
  householdContextReconcileChoiceCopy,
  householdContextReconcileHeading,
  householdContextRelativeTime,
} from "@tendnote/domain/household-context";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { householdContextSensitivityLabel } from "@/lib/household-context-view";

/**
 * What a member sees when somebody else got to the same fact first.
 *
 * Three decisions carry this panel.
 *
 * It is inline, not a dialog. The member's draft is still in the form below and
 * the current statement is right here; a modal would hide one of the two texts
 * the decision is actually between, and it would frame a collision between
 * housemates as an interruption.
 *
 * It is neutral. No destructive colour, no alert treatment, no fault. The other
 * person corrected a shared fact, which is the whole point of a shared fact; the
 * only emphasis is the heading, and the panel sits on `panel` rather than
 * `surface` so it reads as a grouped decision without borrowing state colour.
 *
 * And none of the three choices is the primary action. Making "Replace with
 * mine" sage would be the product quietly recommending that the reader win.
 * They are three equal outlines, in the order the household would want them
 * considered, and the form's own Save keeps the only primary treatment on screen.
 */
export function HouseholdContextReconcilePanel({
  reconciliation,
  viewerUserId,
  identities,
  now,
  onChoose,
  pending = false,
}: {
  reconciliation: HouseholdContextReconciliation;
  viewerUserId: string;
  identities: readonly HouseholdContextActorIdentity[];
  now: Date;
  onChoose: (choice: HouseholdContextReconcileChoice) => void;
  pending?: boolean;
}) {
  const panelId = useId();
  const headingId = `${panelId}-heading`;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // The press that produced this panel was Save, which is still mounted and
    // still focused — so without this the reader is told nothing changed while
    // the answer sits above them, outside the tab position they are at.
    headingRef.current?.focus();
  }, []);

  const { current, draft } = reconciliation;
  const attribution = `${householdContextActorLabel({
    userId: current.lastActorUserId,
    viewerUserId,
    identities,
  })} · ${householdContextRelativeTime(current.updatedAt, now)}`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-panel px-4 py-4"
      data-household-context-reconcile
    >
      <div className="flex min-w-0 flex-col gap-1">
        {/* A focus landing, not a control: `tabIndex={-1}` keeps it out of the tab order. */}
        <h3
          className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
        >
          {householdContextReconcileHeading({ reconciliation, viewerUserId, identities })}
        </h3>
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          {HOUSEHOLD_CONTEXT_RECONCILE_BODY}
        </p>
      </div>

      {/*
        Both statements at the same type size and weight. Preferring one
        typographically would be making the decision for the reader, and the
        comparison is the only reason this panel exists.
      */}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <ReconcileColumn
          content={current.content}
          heading="What's there now"
          meta={`${contextFactCategoryLabel(current.category)} · ${householdContextSensitivityLabel(current.sensitivity)} · ${attribution}`}
        />
        <ReconcileColumn
          content={draft.content}
          heading="What you wrote"
          meta={`${contextFactCategoryLabel(draft.category)} · ${householdContextSensitivityLabel(draft.sensitivity)} · not saved`}
        />
      </div>

      {reconciliation.draftDiffers ? null : (
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Your wording and theirs say the same thing, so keeping theirs loses nothing.
        </p>
      )}

      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        {reconciliation.choices.map((choice) => (
          <div className="flex min-w-0 flex-col gap-1.5" key={choice}>
            <Button
              className="min-h-11 w-full sm:min-h-9"
              data-household-context-reconcile-choice={choice}
              disabled={pending}
              onClick={() => onChoose(choice)}
              type="button"
              variant="outline"
            >
              {householdContextReconcileChoiceCopy[choice].label}
            </Button>
            {/*
              Every hint is visible. Hiding two of the three behind a tooltip
              would make the consequential one look like the explained one.
            */}
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
              {householdContextReconcileChoiceCopy[choice].hint}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReconcileColumn({
  content,
  heading,
  meta,
}: {
  content: string;
  heading: string;
  meta: string;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-surface px-3.5 py-3">
      <h4 className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
        {heading}
      </h4>
      <p className="min-w-0 break-words whitespace-pre-wrap text-[length:var(--text-body)] leading-[var(--text-body-line)]">
        {content}
      </p>
      <p className="min-w-0 break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        {meta}
      </p>
    </article>
  );
}
