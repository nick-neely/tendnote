"use client";

import Link from "next/link";
import { completeFollowupAction, dismissFollowupAction } from "@/app/actions/followups";
import { DueChip } from "@/components/followup-due-chip";
import { CheckIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { DashboardFollowupView } from "@/lib/followup-view";
import { useResolvingAction } from "@/lib/use-resolving-action";

/**
 * Due and upcoming active follow-ups on the dashboard rail (issue #45). A calm,
 * compact prompt — not a task inbox or agenda feed: the few soonest reminders,
 * with quick Complete/Dismiss inline and the person name linking to the full
 * lifecycle on their profile. Only active reminders reach here; suggested
 * follow-ups stay in review surfaces (#48).
 *
 * Controlled by the dashboard rail: the rail owns the list so a tab count and
 * the Overview peek stay in sync as items resolve. Heading and an optional
 * action (e.g. a "See all" link) are passed in so the same list can render as a
 * full tab ("Reminders") or a limited Overview peek. Renders nothing when empty;
 * the rail decides whether an empty tab shows a teaching empty state.
 */
export function DashboardFollowupsSection({
  followups,
  onResolve,
  heading = "Follow-ups",
  headingAction,
}: {
  followups: DashboardFollowupView[];
  onResolve: (id: string) => void;
  heading?: string;
  headingAction?: React.ReactNode;
}) {
  if (followups.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="px-1 text-[length:var(--text-small)] font-medium text-muted-foreground">
          {heading}
        </h2>
        {headingAction}
      </div>
      <div className="overflow-hidden rounded-xl border bg-surface">
        <ul className="divide-y">
          {followups.map((followup) => (
            <FollowupRow followup={followup} key={followup.id} onResolve={onResolve} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function FollowupRow({
  followup,
  onResolve,
}: {
  followup: DashboardFollowupView;
  onResolve: (id: string) => void;
}) {
  const personName = followup.personName ?? "Someone";
  const { leaving, error, pending, run } = useResolvingAction(() => onResolve(followup.id));

  return (
    <li
      className="flex flex-col gap-2.5 px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          className="min-w-0 truncate text-sm font-medium underline-offset-4 transition-colors hover:underline"
          href={`/people/${followup.personId}#follow-ups`}
        >
          {personName}
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <DueChip dueLabel={followup.dueLabel} dueState={followup.dueState} />
          {followup.status === "snoozed" ? (
            <span className="text-[length:var(--text-caption)] text-muted-foreground">Snoozed</span>
          ) : null}
        </div>
      </div>

      <p className="line-clamp-3 text-pretty text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {followup.reason}
      </p>

      <div className="flex items-center justify-end gap-1.5">
        <Button
          aria-label={`Dismiss follow-up for ${personName}`}
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await dismissFollowupAction({ followupId: followup.id });
              if (!result.ok) throw new Error(result.error);
            })
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
          Dismiss
        </Button>
        <Button
          aria-label={`Complete follow-up for ${personName}`}
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await completeFollowupAction({ followupId: followup.id });
              if (!result.ok) throw new Error(result.error);
            })
          }
          size="sm"
          type="button"
        >
          <CheckIcon />
          Complete
        </Button>
      </div>

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
