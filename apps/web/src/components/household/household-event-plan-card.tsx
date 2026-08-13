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
import {
  buildHouseholdEventPlanConflictView,
  type HouseholdEventPlanConflictView,
  type HouseholdEventPlanLinkCandidate,
  type HouseholdEventPlanRecord,
  type HouseholdEventPlanView,
} from "@/lib/household/household-event-plan-view";
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";
import { formatEventWhen } from "@/lib/integrations/calendar-preview";
import { EditHouseholdEventPlanForm } from "./household-event-plan-edit-form";
import { HouseholdEventPlanErrorText } from "./household-event-plan-fields";
import { HouseholdEventPlanLinks } from "./household-event-plan-links";
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
  const [conflict, setConflict] = useState<HouseholdEventPlanConflictView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const archived = plan.status === "archived";

  function handleResult(result: HouseholdEventPlanResult) {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.view.outcome === "conflict") {
      onPlanRefreshed(result.view.current);
      setConflict(
        buildHouseholdEventPlanConflictView({
          current: result.view.current,
          viewerUserId,
          memberNames,
        }),
      );
      onAnnounce("Someone else changed this plan just now. Nothing was archived.");
      return;
    }
    setConflict(null);
    onPlansChange(result.view.plans);
    onAnnounce(archived ? `${plan.title} is back on the list.` : `${plan.title} was archived.`);
  }

  function move(expectedVersion: number) {
    if (pending) return;
    setError(null);
    const archive = actions.archive ?? defaultArchiveAction;
    const restore = actions.restore ?? defaultRestoreAction;
    const lifecycleAction = archived ? restore : archive;
    startTransition(async () => {
      try {
        handleResult(await lifecycleAction({ planId: plan.id, expectedVersion }));
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  function continueAfterConflict() {
    if (!conflict) return;
    move(conflict.version);
  }

  return { archived, conflict, continueAfterConflict, error, move, pending, setConflict };
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
  archived,
  pending,
  onContinue,
  onCancel,
}: {
  conflict: HouseholdEventPlanConflictView;
  archived: boolean;
  pending: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const changedBy = conflict.changedBy === "you" ? "You" : conflict.changedBy;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent-soft/45 px-3.5 py-3">
      <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty">
        {changedBy} changed this plan a moment ago, so nothing was archived. It now reads &ldquo;
        {conflict.title}&rdquo;.
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
          {archived ? "Restore it anyway" : "Archive it anyway"}
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
          archived={lifecycle.archived}
          conflict={lifecycle.conflict}
          onCancel={() => lifecycle.setConflict(null)}
          onContinue={lifecycle.continueAfterConflict}
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
