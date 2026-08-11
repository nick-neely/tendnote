"use client";

import type {
  HouseholdHomeRecord,
  HouseholdHomeSectionView,
} from "@tendnote/domain/household-home";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { completeHouseholdHomeRecordAction } from "@/app/actions/household-home";
import { CheckIcon, GiftIcon, type Icon, ListTodoIcon, RepeatIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

export type HouseholdHomeSectionKey = "needsAttention" | "comingUp";

/**
 * What each section says when the household has nothing in it.
 *
 * Never a reproach, and never a dead end either: the first-run household is the
 * common case for this state, so the supporting line names the one thing that
 * fills the section and links to where that is done. One sentence, because the
 * honest answer really is one sentence (DESIGN.md §6, "better when actionable").
 */
const EMPTY_COPY: Record<HouseholdHomeSectionKey, { title: string; description: string }> = {
  needsAttention: {
    title: "Nothing is waiting on the household.",
    description: "A shared Action or Routine shows up here when its day arrives.",
  },
  comingUp: {
    title: "Nothing shared is dated in the next couple of weeks.",
    description: "A shared Action or Routine shows up here as its date approaches.",
  },
};

/** The section heading treatment every sibling surface already uses. */
const SECTION_HEADING_CLASS =
  "font-semibold text-[length:var(--text-h2)] leading-[var(--text-h2-line)] tracking-normal";

const FAMILY_ICON: Record<HouseholdHomeRecord["family"], Icon> = {
  action: ListTodoIcon,
  routine: RepeatIcon,
  gift_plan: GiftIcon,
};

const GENERIC_FAILURE = "That didn't go through. Nothing changed.";

/** The one domain that currently fills this surface, and where a member goes to add to it. */
const ACTIONS_HREF = "/actions";

/**
 * One capped section of the Household home.
 *
 * Read-first: the row is a canonical link to the record, and the single control
 * is the one reversible mutation the record's own domain already authorizes for
 * anybody who can see it. Everything else — skipping, deferring, pausing,
 * archiving, naming who is looking after it — is on the record, because those
 * are decisions and this is a place to see what is going on.
 *
 * No count, no badge, no severity colour, and no per-member filter. Every fact a
 * row carries is in its text, so the section reads the same to a screen reader,
 * in high contrast, and in monochrome.
 */
export function HouseholdHomeSection({
  sectionKey,
  view,
}: {
  sectionKey: HouseholdHomeSectionKey;
  view: HouseholdHomeSectionView;
}) {
  const headingId = useId();
  const router = useRouter();
  const [records, setRecords] = useServerSyncedList(view.records, (record) => record.identity);
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function complete(record: HouseholdHomeRecord) {
    if (!record.progress) return;
    const progress = record.progress;
    // Captured before the row can leave: settling a record destroys the control
    // the member just pressed, and a keyboard user whose focus falls to the body
    // has lost their place on the page. Focus moves to the next row, or to this
    // section's own heading when the row was the last one.
    const moveFocus = focusAfterRowRemoval(record.identity);
    setPendingIdentity(record.identity);
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const outcome = await completeHouseholdHomeRecordAction({
        generalActionId: record.record.id,
        expectedOccurrenceVersion: progress.expectedOccurrenceVersion,
      });
      setPendingIdentity(null);
      if (!outcome.ok) {
        setError(outcome.error || GENERIC_FAILURE);
        return;
      }
      // Settle on what the household actually has now rather than on what this
      // member was looking at. A tap that arrived second says who got there
      // first; the sibling section reconciles through the server tree.
      const settled = outcome.view[sectionKey].records;
      setRecords(settled);
      setStatus(outcome.view.reconciliation ?? `${record.title} is done.`);
      if (settled.some((entry) => entry.identity === record.identity)) {
        // The row that stays needs this as much as the row that leaves. A
        // Routine rolls forward and keeps its place, but the control was
        // `disabled` for the length of the write, and disabling the focused
        // element blurs it — so settling bin day from the keyboard dropped the
        // member on `body` beside a row that was still sitting there.
        restoreRowFocus(record.identity);
      } else {
        moveFocus();
      }
      router.refresh();
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 className={SECTION_HEADING_CLASS} id={headingId}>
        {view.heading}
      </h2>

      {records.length > 0 ? (
        <ul className="flex list-none flex-col divide-y border-t border-b">
          {records.map((record) => (
            <HouseholdHomeRow
              key={record.identity}
              onComplete={() => complete(record)}
              pending={pendingIdentity === record.identity}
              record={record}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={ACTIONS_HREF}>Go to Actions</Link>
            </Button>
          }
          description={EMPTY_COPY[sectionKey].description}
          title={EMPTY_COPY[sectionKey].title}
        />
      )}

      {view.more ? (
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          The rest is in{" "}
          {view.more.destinations.map((destination, index) => (
            <span key={destination.href}>
              {index > 0 ? ", " : null}
              <Link
                className="font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                href={destination.href}
              >
                {destination.label}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}

      {view.limitations.map((limitation) => (
        <p
          className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
          key={limitation}
          role="status"
        >
          {limitation}
        </p>
      ))}

      {/* Announced without stealing focus: focus has already been moved to the
          member's place in the list, and the outcome is read out where it
          happened. One region for both the in-flight line and the settled one,
          so a screen reader hears a sequence rather than two competing voices. */}
      <p
        className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)] empty:hidden"
        role="status"
      >
        {pendingIdentity ? "Updating Household…" : status}
      </p>
      {error ? (
        <p
          className="text-[length:var(--text-small)] text-destructive leading-[var(--text-small-line)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function HouseholdHomeRow({
  onComplete,
  pending,
  record,
}: {
  onComplete: () => void;
  pending: boolean;
  record: HouseholdHomeRecord;
}) {
  const FamilyIcon = FAMILY_ICON[record.family];
  return (
    <li
      aria-busy={pending || undefined}
      className="flex items-start gap-3 py-4"
      data-household-row={record.identity}
    >
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <FamilyIcon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]">
          {record.context}
        </p>
        <Link
          className="w-fit font-medium text-[length:var(--text-title)] leading-[var(--text-title-line)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={record.record.href}
        >
          {record.title}
        </Link>
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {record.timing.explanation}
        </p>
        {/* Attribution and responsibility are two different facts and never one
            line: who the record belongs to, and who said they have it. Text
            rather than pills, because a badge reads as a status the row is
            reporting and neither of these is one. */}
        <p className="text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]">
          {record.scopeLabel}
          {record.responsibility ? ` · ${record.responsibility}` : null}
        </p>
        {record.progress ? (
          <div className="mt-2">
            <Button
              aria-label={`${record.progress.label}: ${record.title}`}
              className="min-h-11"
              disabled={pending}
              onClick={onComplete}
              size="sm"
              type="button"
              variant="secondary"
            >
              {pending ? (
                <Spinner aria-hidden data-icon="inline-start" />
              ) : (
                <CheckIcon aria-hidden data-icon="inline-start" />
              )}
              {record.progress.label}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Where focus goes when the row it was on is settled away.
 *
 * The same contract Today uses for the same interaction: the next row's first
 * control, or the section heading when nothing is left. Captured while the row
 * is still mounted, because after the update there is nothing left to measure
 * from.
 */
function focusAfterRowRemoval(identity: string): () => void {
  const row = Array.from(document.querySelectorAll<HTMLElement>("[data-household-row]")).find(
    (candidate) => candidate.dataset.householdRow === identity,
  );
  return captureFocusAfterRemoval(row, "h2");
}

/**
 * Puts focus back on the control the member pressed, for the row that survived.
 *
 * Re-queried after the commit rather than captured before it, so it finds the
 * control the render actually left in place. It gives up unless focus is on
 * `body`: `body` is the signature of the blur that disabling the button caused,
 * and anywhere else is somewhere the member chose to be since.
 */
function restoreRowFocus(identity: string): void {
  requestAnimationFrame(() => {
    if (document.activeElement !== document.body) return;
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-household-row]")).find(
      (candidate) => candidate.dataset.householdRow === identity,
    );
    row?.querySelector<HTMLButtonElement>("button")?.focus();
  });
}

/** A section-shaped reserve: the heading it will have, and rows the size of rows. */
export function HouseholdHomeSectionReserve({ heading }: { heading: string }) {
  return (
    <section aria-busy="true" aria-label={`Loading ${heading}`} className="flex flex-col gap-3">
      <h2 className={SECTION_HEADING_CLASS}>{heading}</h2>
      <div className="flex flex-col divide-y border-t border-b">
        {[0, 1, 2].map((row) => (
          <div className="flex items-start gap-3 py-4" key={row}>
            <div className="size-9 shrink-0 animate-pulse rounded-lg bg-muted/60" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-3 w-16 animate-pulse rounded bg-muted/60" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted/60" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted/60" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
