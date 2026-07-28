"use client";

import Link from "next/link";
import { completeFollowupAction, dismissFollowupAction } from "@/app/actions/followups";
import { CheckIcon, XIcon } from "@/components/icons";
import { RecordTimingChip } from "@/components/record-timing-chip";
import { MutationFeedback, MutationUndo } from "@/components/suggestion-review-controls";
import { Button } from "@/components/ui/button";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import { followupLifecycleAdapter } from "@/lib/followup-reversible-mutation";
import type { DashboardFollowupView } from "@/lib/followup-view";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import {
  ReversibleMutationProvider,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";

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
  fallbackFocusTarget,
}: {
  followups: DashboardFollowupView[];
  onResolve: (id: string) => void;
  heading?: string;
  headingAction?: React.ReactNode;
  fallbackFocusTarget?: () => HTMLElement | null;
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
            <FollowupRow
              fallbackFocusTarget={fallbackFocusTarget}
              followup={followup}
              key={followup.id}
              onResolve={onResolve}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function FollowupRow({
  ...props
}: {
  followup: DashboardFollowupView;
  onResolve: (id: string) => void;
  fallbackFocusTarget?: () => HTMLElement | null;
}) {
  return (
    <ReversibleMutationProvider>
      <FollowupRowContent {...props} />
    </ReversibleMutationProvider>
  );
}

function FollowupRowContent({
  followup,
  onResolve,
  fallbackFocusTarget,
}: {
  followup: DashboardFollowupView;
  onResolve: (id: string) => void;
  fallbackFocusTarget?: () => HTMLElement | null;
}) {
  const personName = followup.personName ?? "Someone";
  const completeMutation = useReversibleMutation(followup.id, "complete");
  const dismissMutation = useReversibleMutation(followup.id, "dismiss");
  const activeMutation = useActiveReversibleMutation(followup.id, ["complete", "dismiss"]);
  const { error = null, leaving = false, pending = false } = activeMutation?.state ?? {};
  // fallow-ignore-next-line complexity -- The compact rail row shares one reversible path for the two lifecycle outcomes and their exact inverse.
  function resolve(
    intent: "complete" | "dismiss",
    command: () => Promise<OwnerActionResult<DashboardFollowupView>>,
    focusTarget: HTMLElement,
  ) {
    const mutation = intent === "complete" ? completeMutation : dismissMutation;
    const moveFocus = captureFocusAfterRemoval(
      focusTarget.closest<HTMLElement>("[data-dashboard-followup-row]"),
      "h2",
      fallbackFocusTarget,
    );
    mutation.run({
      kind: "optimistic",
      adapter: followupLifecycleAdapter<DashboardFollowupView>(intent),
      apply: () => true,
      command,
      focusTarget,
      labels: {
        pending: `${intent === "complete" ? "Completing" : "Dismissing"} follow-up…`,
        success: `Follow-up ${intent === "complete" ? "completed" : "dismissed"}. Undo available.`,
        rollback: "The follow-up was restored after the change failed.",
        undo: `Undo ${intent === "complete" ? "Complete" : "Dismiss"}`,
        undone: "Follow-up restored.",
      },
      leave: {
        apply: () => {
          onResolve(followup.id);
          moveFocus();
          return true;
        },
      },
      prior: followup,
    });
  }

  return (
    <li aria-busy={pending} className="flex flex-col gap-2.5 px-4 py-3" data-dashboard-followup-row>
      <div
        className="flex flex-col gap-2.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
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
            <RecordTimingChip label={followup.surfaceLabel} state={followup.dueState} />
            {followup.status === "snoozed" ? (
              <span className="text-[length:var(--text-caption)] text-muted-foreground">
                Snoozed
              </span>
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
            onClick={(event) =>
              resolve(
                "dismiss",
                async () => {
                  const result = await dismissFollowupAction({ followupId: followup.id });
                  return result.ok ? { ok: true, view: { ...followup, ...result.view } } : result;
                },
                event.currentTarget,
              )
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
            onClick={(event) =>
              resolve(
                "complete",
                async () => {
                  const result = await completeFollowupAction({ followupId: followup.id });
                  return result.ok ? { ok: true, view: { ...followup, ...result.view } } : result;
                },
                event.currentTarget,
              )
            }
            size="sm"
            type="button"
          >
            <CheckIcon />
            Complete
          </Button>
        </div>

        <MutationFeedback
          error={error}
          pendingLabel={pending ? (activeMutation?.state.labels.pending ?? null) : null}
        />
      </div>
      {activeMutation ? (
        <MutationUndo requestUndo={activeMutation.requestUndo} state={activeMutation.state} />
      ) : null}
    </li>
  );
}
