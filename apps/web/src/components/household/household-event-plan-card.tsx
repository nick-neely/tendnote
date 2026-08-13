import type {
  HouseholdEventPlan,
  HouseholdEventPlanCalendarReference,
} from "@tendnote/domain/household-event-plans";
import { useState, useTransition } from "react";
import {
  archiveHouseholdEventPlanAction as defaultArchiveAction,
  restoreHouseholdEventPlanAction as defaultRestoreAction,
  updateHouseholdEventPlanAction as defaultUpdateAction,
  type HouseholdEventPlanResult,
} from "@/app/actions/household-event-plans";
import { CalendarDotsIcon, HistoryIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type {
  HouseholdEventPlanConflictView,
  HouseholdEventPlanLinkCandidate,
  HouseholdEventPlanRecord,
  HouseholdEventPlanView,
} from "@/lib/household/household-event-plan-view";
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";
import { formatEventWhen } from "@/lib/integrations/calendar-preview";
import { EditHouseholdEventPlanForm } from "./household-event-plan-edit-form";
import { HouseholdEventPlanErrorText } from "./household-event-plan-fields";
import { HouseholdEventPlanLinks } from "./household-event-plan-links";
import { handleHouseholdEventPlanResult } from "./household-event-plan-result";
import type { HouseholdEventPlanActions } from "./household-event-plan-types";

type PlanCardProps = {
  plan: HouseholdEventPlanView;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  linkCandidates: readonly HouseholdEventPlanLinkCandidate[];
  actions: HouseholdEventPlanActions;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onPlanRefreshed: (plan: HouseholdEventPlan) => void;
  onAnnounce: (message: string) => void;
};

type LifecycleOperation = "archive" | "restore";

type LifecycleConflictState = {
  current: HouseholdEventPlan;
  operation: LifecycleOperation;
  view: HouseholdEventPlanConflictView;
};

function PlanCalendarReference({ reference }: { reference: HouseholdEventPlanCalendarReference }) {
  if (reference.state === "none") return null;
  if (reference.state === "unavailable") {
    return (
      <p className="flex items-start gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
        <CalendarDotsIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>The calendar this refers to isn&rsquo;t available right now.</span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
      <CalendarDotsIcon aria-hidden className="size-3.5 shrink-0 self-center" />
      <span className="font-mono text-[length:var(--text-caption)]">
        {formatEventWhen(reference.start, reference.allDay)}
      </span>
      <span className="min-w-0">{reference.title ?? "Untitled event"}</span>
      <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)]">
        on {reference.label}
      </span>
      {reference.stale ? (
        <span className="flex items-center gap-1 text-[length:var(--text-caption)] leading-[var(--text-caption-line)]">
          <HistoryIcon aria-hidden className="size-3 shrink-0" />
          <span>· may be out of date</span>
        </span>
      ) : null}
    </p>
  );
}

function PlanProvenance({ plan }: { plan: HouseholdEventPlanView }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
      <span>Started by {plan.provenance.startedBy}</span>
      {plan.provenance.changedBy ? <span>· changed by {plan.provenance.changedBy}</span> : null}
      <span className="font-mono">· {plan.provenance.atLabel}</span>
    </p>
  );
}

function usePlanLifecycle({
  plan,
  viewerUserId,
  memberNames,
  actions,
  onPlansChange,
  onPlanRefreshed,
  onAnnounce,
}: PlanCardProps) {
  const [conflict, setConflict] = useState<LifecycleConflictState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const archived = plan.status === "archived";

  function handleResult(result: HouseholdEventPlanResult, operation: LifecycleOperation) {
    handleHouseholdEventPlanResult(
      result,
      { viewerUserId, memberNames },
      {
        onError: setError,
        onConflict: ({ conflict: nextConflict, current }) => {
          // Keep a status-changing conflict mounted in its current collection
          // until the member chooses. Moving it between Active and Archived
          // here would unmount the card and erase both the explanation and the
          // original operation. Same-status refreshes stay visible behind it.
          if (current.status === plan.status) onPlanRefreshed(current);
          setConflict({ current, operation, view: nextConflict });
          onAnnounce(
            `Someone else changed this plan just now. Your ${operation} didn’t go through.`,
          );
        },
        onSaved: (plans) => {
          setConflict(null);
          onPlansChange(plans);
          onAnnounce(
            operation === "restore"
              ? `${plan.title} is back on the list.`
              : `${plan.title} was archived.`,
          );
        },
      },
    );
  }

  function move(
    expectedVersion: number,
    operation: LifecycleOperation = archived ? "restore" : "archive",
  ) {
    if (pending) return;
    setError(null);
    const archive = actions.archive ?? defaultArchiveAction;
    const restore = actions.restore ?? defaultRestoreAction;
    const lifecycleAction = operation === "restore" ? restore : archive;
    startTransition(async () => {
      try {
        handleResult(await lifecycleAction({ planId: plan.id, expectedVersion }), operation);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  function continueAfterConflict() {
    if (!conflict) return;
    move(conflict.view.version, conflict.operation);
  }

  function leaveConflict() {
    if (!conflict) return;
    onPlanRefreshed(conflict.current);
    setConflict(null);
  }

  return { archived, conflict, continueAfterConflict, error, leaveConflict, move, pending };
}

function lifecycleLabel(archived: boolean, pending: boolean) {
  if (archived) return pending ? "Restoring…" : "Restore";
  return pending ? "Archiving…" : "Archive";
}

function PlanHeader({
  plan,
  archived,
  editing,
  pending,
  onEdit,
  onMove,
}: {
  plan: HouseholdEventPlanView;
  archived: boolean;
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onMove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium text-pretty">
          {plan.title}
        </span>
      </span>
      {editing ? null : (
        <span className="flex shrink-0 flex-wrap justify-end gap-2">
          {archived ? null : (
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={onEdit}
              size="sm"
              type="button"
              variant="outline"
            >
              Edit
            </Button>
          )}
          <Button
            className="min-h-11 sm:min-h-8"
            disabled={pending}
            onClick={onMove}
            size="sm"
            type="button"
            variant="ghost"
          >
            {lifecycleLabel(archived, pending)}
          </Button>
        </span>
      )}
    </div>
  );
}

function LifecycleConflict({
  conflict,
  operation,
  pending,
  onContinue,
  onCancel,
}: {
  conflict: HouseholdEventPlanConflictView;
  operation: LifecycleOperation;
  pending: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const changedBy = conflict.changedBy === "you" ? "You" : conflict.changedBy;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent-soft/45 px-3.5 py-3">
      <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty">
        {changedBy} changed this plan a moment ago, so your {operation} didn&rsquo;t go through. It
        now reads &ldquo;{conflict.title}&rdquo;.
      </p>
      <p className="font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
        {conflict.atLabel}
      </p>
      <span className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={onContinue}
          size="sm"
          type="button"
          variant="outline"
        >
          {operation === "restore" ? "Restore it anyway" : "Archive it anyway"}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          Leave it as it is
        </Button>
      </span>
    </div>
  );
}

function PlanReadBody({
  plan,
  linkCandidates,
  actions,
  onPlansChange,
  onAnnounce,
}: Pick<PlanCardProps, "plan" | "linkCandidates" | "actions" | "onPlansChange" | "onAnnounce">) {
  return (
    <>
      {plan.plannedForLabel ? (
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {plan.plannedForLabel}
        </p>
      ) : null}
      {plan.details ? (
        <p className="max-w-[65ch] text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty whitespace-pre-wrap">
          {plan.details}
        </p>
      ) : null}
      <HouseholdEventPlanLinks
        actions={actions}
        candidates={linkCandidates}
        onAnnounce={onAnnounce}
        onPlansChange={onPlansChange}
        plan={plan}
      />
      <PlanProvenance plan={plan} />
    </>
  );
}

/** One Plan, with symmetric member controls and explicit lifecycle conflicts. */
export function HouseholdEventPlanCard(props: PlanCardProps) {
  const [editing, setEditing] = useState(false);
  const lifecycle = usePlanLifecycle(props);
  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-surface px-4 py-3.5">
      <PlanHeader
        archived={lifecycle.archived}
        editing={editing}
        onEdit={() => setEditing(true)}
        onMove={() => lifecycle.move(props.plan.version)}
        pending={lifecycle.pending}
        plan={props.plan}
      />
      <PlanCalendarReference reference={props.plan.calendar} />
      {lifecycle.conflict ? (
        <LifecycleConflict
          conflict={lifecycle.conflict.view}
          onCancel={lifecycle.leaveConflict}
          onContinue={lifecycle.continueAfterConflict}
          operation={lifecycle.conflict.operation}
          pending={lifecycle.pending}
        />
      ) : null}
      {editing ? (
        <EditHouseholdEventPlanForm
          memberNames={props.memberNames}
          onAnnounce={props.onAnnounce}
          onClose={() => setEditing(false)}
          onPlanRefreshed={props.onPlanRefreshed}
          onPlansChange={props.onPlansChange}
          plan={props.plan}
          update={props.actions.update ?? defaultUpdateAction}
          viewerUserId={props.viewerUserId}
        />
      ) : (
        <PlanReadBody
          actions={props.actions}
          linkCandidates={props.linkCandidates}
          onAnnounce={props.onAnnounce}
          onPlansChange={props.onPlansChange}
          plan={props.plan}
        />
      )}
      {lifecycle.error ? <HouseholdEventPlanErrorText message={lifecycle.error} /> : null}
    </li>
  );
}
