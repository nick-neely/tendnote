import type { HouseholdEventPlan } from "@tendnote/domain/household-event-plans";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { HouseholdEventPlanResult } from "@/app/actions/household-event-plans";
import { Button } from "@/components/ui/button";
import {
  buildHouseholdEventPlanConflictView,
  type HouseholdEventPlanConflictView,
  type HouseholdEventPlanRecord,
  type HouseholdEventPlanView,
} from "@/lib/household/household-event-plan-view";
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";
import {
  HouseholdEventPlanErrorText,
  HouseholdEventPlanFields,
} from "./household-event-plan-fields";
import type { HouseholdEventPlanActions } from "./household-event-plan-types";

type EditPlanProps = {
  plan: HouseholdEventPlanView;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  update: NonNullable<HouseholdEventPlanActions["update"]>;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onPlanRefreshed: (plan: HouseholdEventPlan) => void;
  onAnnounce: (message: string) => void;
  onClose: () => void;
};

function useEditPlanController({
  plan,
  viewerUserId,
  memberNames,
  update,
  onPlansChange,
  onPlanRefreshed,
  onAnnounce,
  onClose,
}: EditPlanProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const conflictRef = useRef<HTMLParagraphElement>(null);
  const [title, setTitle] = useState(plan.title);
  const [details, setDetails] = useState(plan.details ?? "");
  const [plannedFor, setPlannedFor] = useState(plan.plannedForInput);
  const [expectedVersion, setExpectedVersion] = useState(plan.version);
  const [conflict, setConflict] = useState<HouseholdEventPlanConflictView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trimmed = title.trim();

  useEffect(() => {
    if (conflict) conflictRef.current?.focus();
  }, [conflict]);

  function handleResult(result: HouseholdEventPlanResult) {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.view.outcome === "conflict") {
      // Their draft is untouched on purpose: every piece of state this form
      // holds about what they typed survives this branch.
      onPlanRefreshed(result.view.current);
      setConflict(
        buildHouseholdEventPlanConflictView({
          current: result.view.current,
          viewerUserId,
          memberNames,
        }),
      );
      onAnnounce(result.view.message);
      return;
    }
    onPlansChange(result.view.plans);
    onAnnounce(`${trimmed} was saved.`);
    onClose();
  }

  function save(version: number) {
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await update({
          planId: plan.id,
          expectedVersion: version,
          draft: {
            title: trimmed,
            details: details.trim() ? details : null,
            plannedFor: plannedFor || null,
            // A write replaces the whole value. Restating this prevents a typo
            // fix from dropping the provider event the Plan points at.
            calendarEvent: plan.calendarAddress,
          },
        });
        handleResult(result);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  function keepEditingMine() {
    if (!conflict) return;
    setExpectedVersion(conflict.version);
    setConflict(null);
    titleRef.current?.focus();
  }

  function saveOverConflict() {
    if (!conflict) return;
    save(conflict.version);
  }

  return {
    conflict,
    conflictRef,
    details,
    error,
    expectedVersion,
    keepEditingMine,
    pending,
    plannedFor,
    save,
    saveOverConflict,
    setDetails,
    setPlannedFor,
    setTitle,
    title,
    titleRef,
    trimmed,
  };
}

function EditConflict({
  conflict,
  pending,
  conflictRef,
  onSaveMine,
  onKeepEditing,
  onUseTheirs,
}: {
  conflict: HouseholdEventPlanConflictView;
  pending: boolean;
  conflictRef: React.RefObject<HTMLParagraphElement | null>;
  onSaveMine: () => void;
  onKeepEditing: () => void;
  onUseTheirs: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent-soft/45 px-3.5 py-3">
      <p
        className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-pretty outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        ref={conflictRef}
        tabIndex={-1}
      >
        Someone else changed this plan while you were writing. Your draft is kept below.
      </p>
      <div className="flex flex-col gap-1">
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty">
          It now reads &ldquo;{conflict.title}&rdquo;
          {conflict.plannedForLabel ? `, on ${conflict.plannedForLabel}` : ""}.
        </p>
        {conflict.details ? (
          <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty whitespace-pre-wrap text-muted-foreground">
            {conflict.details}
          </p>
        ) : null}
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
          Changed by {conflict.changedBy} <span className="font-mono">· {conflict.atLabel}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={onSaveMine}
          size="sm"
          type="button"
        >
          {pending ? "Saving…" : "Save mine over theirs"}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={onKeepEditing}
          size="sm"
          type="button"
          variant="outline"
        >
          Keep editing mine
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={onUseTheirs}
          size="sm"
          type="button"
          variant="ghost"
        >
          Use their version
        </Button>
      </div>
    </div>
  );
}

function EditActions({
  blocked,
  pending,
  onClose,
}: {
  blocked: boolean;
  pending: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button className="min-h-11 sm:min-h-8" disabled={pending || blocked} size="sm" type="submit">
        {pending ? "Saving…" : "Save changes"}
      </Button>
      <Button
        className="min-h-11 sm:min-h-8"
        disabled={pending}
        onClick={onClose}
        size="sm"
        type="button"
        variant="ghost"
      >
        Cancel
      </Button>
    </div>
  );
}

/** Editing a Plan, including the explicit lost-update resolution contract. */
export function EditHouseholdEventPlanForm(props: EditPlanProps) {
  const fieldId = useId();
  const controller = useEditPlanController(props);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        controller.save(controller.expectedVersion);
      }}
    >
      {controller.conflict ? (
        <EditConflict
          conflict={controller.conflict}
          conflictRef={controller.conflictRef}
          onKeepEditing={controller.keepEditingMine}
          onSaveMine={controller.saveOverConflict}
          onUseTheirs={props.onClose}
          pending={controller.pending}
        />
      ) : null}

      <HouseholdEventPlanFields
        details={controller.details}
        disabled={controller.pending}
        ids={{
          title: `${fieldId}-title`,
          details: `${fieldId}-details`,
          plannedFor: `${fieldId}-planned-for`,
        }}
        invalid={Boolean(controller.error)}
        onDetails={controller.setDetails}
        onPlannedFor={controller.setPlannedFor}
        onTitle={controller.setTitle}
        plannedFor={controller.plannedFor}
        title={controller.title}
        titleRef={controller.titleRef}
      />

      <EditActions
        blocked={controller.trimmed.length === 0 || Boolean(controller.conflict)}
        onClose={props.onClose}
        pending={controller.pending}
      />
      {controller.error ? <HouseholdEventPlanErrorText message={controller.error} /> : null}
    </form>
  );
}
