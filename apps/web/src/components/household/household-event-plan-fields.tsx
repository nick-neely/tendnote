import {
  HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT,
  HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT,
} from "@tendnote/domain/household-event-plans";
import type { RefObject } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function HouseholdEventPlanErrorText({ id, message }: { id?: string; message: string }) {
  return (
    <p
      className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
      id={id}
      role="alert"
    >
      {message}
    </p>
  );
}

/** The three fields a Plan has. Shared by the new-plan and edit forms. */
export function HouseholdEventPlanFields({
  ids,
  title,
  details,
  plannedFor,
  disabled,
  invalid,
  titleRef,
  onTitle,
  onDetails,
  onPlannedFor,
}: {
  ids: { title: string; details: string; plannedFor: string };
  title: string;
  details: string;
  plannedFor: string;
  disabled: boolean;
  invalid: boolean;
  titleRef?: RefObject<HTMLInputElement | null>;
  onTitle: (value: string) => void;
  onDetails: (value: string) => void;
  onPlannedFor: (value: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.title}>What is it</Label>
        <Input
          aria-invalid={invalid ? true : undefined}
          autoComplete="off"
          className="h-11 sm:h-8"
          disabled={disabled}
          id={ids.title}
          maxLength={HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT}
          name="householdEventPlanTitle"
          onChange={(event) => onTitle(event.target.value)}
          placeholder="Mara's birthday dinner"
          ref={titleRef}
          value={title}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.plannedFor}>When (optional)</Label>
        <Input
          className="h-11 w-fit sm:h-8"
          disabled={disabled}
          id={ids.plannedFor}
          name="householdEventPlanDate"
          onChange={(event) => onPlannedFor(event.target.value)}
          type="date"
          value={plannedFor}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.details}>Notes (optional)</Label>
        <Textarea
          disabled={disabled}
          id={ids.details}
          maxLength={HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT}
          name="householdEventPlanDetails"
          onChange={(event) => onDetails(event.target.value)}
          placeholder="What still needs sorting out."
          rows={3}
          value={details}
        />
      </div>
    </>
  );
}
