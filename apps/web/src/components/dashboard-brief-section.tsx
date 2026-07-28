"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  acceptBriefFollowupAction,
  dismissBriefItemAction,
  generateBriefAction,
  snoozeBriefItemAction,
} from "@/app/actions/briefs";
import {
  CheckIcon,
  ClockIcon,
  LockIcon,
  PenLineIcon,
  RefreshCwIcon,
  XIcon,
} from "@/components/icons";
import { RecordTimingChip } from "@/components/record-timing-chip";
import { Button } from "@/components/ui/button";
import { useCreateDraft } from "@/components/use-create-draft";
import type { BriefItemView, BriefView } from "@/lib/brief-view";
import { ownerActionFailureMessage, unwrapOwnerActionResult } from "@/lib/owner-action-result";

const CADENCE_COPY = {
  daily: {
    heading: "Today's brief",
    empty: "No brief yet. It gathers the people worth a thought today.",
  },
  weekly: {
    heading: "This week",
    empty: "No weekly review yet. It gathers the people you haven't been in touch with lately.",
  },
} as const;

/**
 * Renders a persisted daily brief or weekly relationship review on the dashboard
 * rail (PRD #65, issue #70). It reads the stored item snapshots — never the live
 * relationship agenda — shows the optional friendly summary when present, and
 * lets the user dismiss or snooze items inline. A missing brief degrades to a calm
 * empty state with a single generate action; an existing brief offers a quiet
 * regenerate. Same calm surface as the rest of the rail, not a task feed.
 */
export function DashboardBriefSection({
  cadence,
  brief,
}: {
  cadence: "daily" | "weekly";
  brief: BriefView | null;
}) {
  const copy = CADENCE_COPY[cadence];
  const [items, setItems] = useState<BriefItemView[]>(brief?.items ?? []);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function regenerate() {
    setError(null);
    startTransition(async () => {
      try {
        unwrapOwnerActionResult(await generateBriefAction({ cadence, regenerate: true }));
      } catch (error) {
        setError(ownerActionFailureMessage(error) ?? "Couldn't refresh the brief. Try again.");
      }
    });
  }

  function generate() {
    setError(null);
    startTransition(async () => {
      try {
        unwrapOwnerActionResult(await generateBriefAction({ cadence }));
      } catch (error) {
        setError(ownerActionFailureMessage(error) ?? "Couldn't generate the brief. Try again.");
      }
    });
  }

  const hasItems = items.length > 0;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="px-1 text-[length:var(--text-small)] font-medium text-muted-foreground">
          {copy.heading}
        </h2>
        {brief ? (
          <Button
            aria-label={`Refresh ${copy.heading}`}
            className="text-muted-foreground"
            disabled={pending}
            onClick={regenerate}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
            Refresh
          </Button>
        ) : null}
      </div>

      {brief?.summary ? (
        <p className="text-pretty px-1 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {brief.summary}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border bg-surface">
        {hasItems ? (
          <ul className="divide-y">
            {items.map((item) => (
              <BriefItemRow item={item} key={item.id} onResolve={resolve} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-start gap-3 px-4 py-4">
            <p className="text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              {copy.empty}
            </p>
            <Button disabled={pending} onClick={generate} size="sm" type="button">
              {pending ? "Generating…" : "Generate"}
            </Button>
          </div>
        )}
      </div>

      {error ? (
        <p className="px-1 text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Accessible names for a row's actions. A brief item is usually about a person,
 * but not always, so each label has a person-free form rather than falling back
 * to a pronoun that would read as "Snooze brief item for this".
 */
function briefItemActionLabels(person: string | null) {
  if (!person) {
    return {
      snooze: "Snooze this brief item",
      dismiss: "Dismiss this brief item",
      draft: "Draft a message",
      accept: "Accept this suggested follow-up",
    };
  }

  return {
    snooze: `Snooze brief item for ${person}`,
    dismiss: `Dismiss brief item for ${person}`,
    draft: `Draft a message for ${person}`,
    accept: `Accept suggested follow-up for ${person}`,
  };
}

function BriefItemRow({
  item,
  onResolve,
}: {
  item: BriefItemView;
  onResolve: (id: string) => void;
}) {
  const { create: createDraft, pending: draftPending, error: draftError } = useCreateDraft();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const labels = briefItemActionLabels(item.personName);

  function run(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setLeaving(true);
        window.setTimeout(() => onResolve(item.id), 200);
      } catch {
        setError("That didn't go through. Try again.");
      }
    });
  }

  return (
    <li
      className="flex flex-col gap-2.5 px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
    >
      <div className="flex items-start justify-between gap-2">
        {item.personId ? (
          <Link
            className="min-w-0 text-pretty text-sm font-medium underline-offset-4 transition-colors hover:underline"
            href={`/people/${item.personId}`}
          >
            {item.title}
          </Link>
        ) : (
          <span className="min-w-0 text-pretty text-sm font-medium">{item.title}</span>
        )}
        {item.surfaceLabel && item.dueState ? (
          <span className="shrink-0">
            <RecordTimingChip label={item.surfaceLabel} state={item.dueState} />
          </span>
        ) : null}
      </div>

      <p className="line-clamp-3 text-pretty text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {item.reason}
      </p>

      <div className="flex items-center justify-between gap-2">
        {item.isSensitive ? (
          <span className="inline-flex items-center gap-1 text-[length:var(--text-caption)] text-muted-foreground">
            <LockIcon aria-hidden className="size-3" />
            Sensitive
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <Button
            aria-label={labels.snooze}
            disabled={pending}
            onClick={() =>
              run(async () =>
                unwrapOwnerActionResult(await snoozeBriefItemAction({ briefItemId: item.id })),
              )
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <ClockIcon />
            Later
          </Button>
          <Button
            aria-label={labels.dismiss}
            disabled={pending}
            onClick={() =>
              run(async () =>
                unwrapOwnerActionResult(await dismissBriefItemAction({ briefItemId: item.id })),
              )
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
            Dismiss
          </Button>
          {item.personId ? (
            <Button
              aria-label={labels.draft}
              disabled={draftPending}
              onClick={() =>
                createDraft({
                  personId: item.personId as string,
                  briefItemContext: { id: item.id, title: item.title, reason: item.reason },
                })
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <PenLineIcon />
              Draft
            </Button>
          ) : null}
          {item.isSuggestedFollowup ? (
            <Button
              aria-label={labels.accept}
              disabled={pending}
              onClick={() =>
                run(async () =>
                  unwrapOwnerActionResult(
                    await acceptBriefFollowupAction({ briefItemId: item.id }),
                  ),
                )
              }
              size="sm"
              type="button"
            >
              <CheckIcon />
              Accept
            </Button>
          ) : null}
        </div>
      </div>

      {error || draftError ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error ?? draftError}
        </p>
      ) : null}
    </li>
  );
}
