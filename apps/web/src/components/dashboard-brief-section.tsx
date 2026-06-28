"use client";

import { ClockIcon, LockIcon, RefreshCwIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  dismissBriefItemAction,
  generateBriefAction,
  snoozeBriefItemAction,
} from "@/app/actions/briefs";
import { DueChip } from "@/components/followup-due-chip";
import { Button } from "@/components/ui/button";
import type { BriefItemView, BriefView } from "@/lib/brief-view";

const CADENCE_COPY = {
  daily: {
    heading: "Today's brief",
    empty: "No brief yet. Generate a few people who deserve a thought today.",
  },
  weekly: {
    heading: "This week",
    empty: "No weekly review yet. Pull together stale contacts and lower-priority context.",
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
        await generateBriefAction({ cadence, regenerate: true });
      } catch {
        setError("Couldn't refresh the brief. Try again.");
      }
    });
  }

  function generate() {
    setError(null);
    startTransition(async () => {
      try {
        await generateBriefAction({ cadence });
      } catch {
        setError("Couldn't generate the brief. Try again.");
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
            aria-label={`Regenerate ${copy.heading}`}
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

function BriefItemRow({
  item,
  onResolve,
}: {
  item: BriefItemView;
  onResolve: (id: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = item.personName ?? "this";

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
        {item.dueLabel && item.dueState ? (
          <span className="shrink-0">
            <DueChip dueLabel={item.dueLabel} dueState={item.dueState} />
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
            aria-label={`Snooze brief item for ${label}`}
            disabled={pending}
            onClick={() => run(() => snoozeBriefItemAction({ briefItemId: item.id }))}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ClockIcon />
            Later
          </Button>
          <Button
            aria-label={`Dismiss brief item for ${label}`}
            disabled={pending}
            onClick={() => run(() => dismissBriefItemAction({ briefItemId: item.id }))}
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
            Dismiss
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
