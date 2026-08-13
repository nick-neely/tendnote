import type { FormEvent } from "react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CalendarDotsIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { HouseholdEventPlanRecord } from "@/lib/household/household-event-plan-view";
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";
import {
  HouseholdEventPlanErrorText,
  HouseholdEventPlanFields,
} from "./household-event-plan-fields";
import type {
  HouseholdEventPlanActions,
  PendingHouseholdCalendarEvent,
} from "./household-event-plan-types";

function CalendarEventAttachment({ attachment }: { attachment: PendingHouseholdCalendarEvent }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        <CalendarDotsIcon aria-hidden className="size-3.5 shrink-0 self-center" />
        <span className="font-mono text-[length:var(--text-caption)]">{attachment.whenLabel}</span>
        <span className="min-w-0">{attachment.eventTitle}</span>
        <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)]">
          on {attachment.calendarLabel}
        </span>
      </p>
      <p className="max-w-[65ch] text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
        This plan will point at that event. It stays your household&rsquo;s own note, so give it a
        name in your own words.
      </p>
    </div>
  );
}

export function NewHouseholdEventPlanForm({
  attachment,
  create,
  onPlansChange,
  onAnnounce,
  onClose,
}: {
  attachment: PendingHouseholdCalendarEvent | null;
  create: NonNullable<HouseholdEventPlanActions["create"]>;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onAnnounce: (message: string) => void;
  onClose: () => void;
}) {
  const fieldId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [plannedFor, setPlannedFor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // The form is summoned by a press elsewhere on the screen, including one on
    // a calendar row well above it, so the caret has to arrive with it.
    titleRef.current?.focus();
  }, []);

  const trimmed = title.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await create({
          draft: {
            title: trimmed,
            details: details.trim() ? details : null,
            plannedFor: plannedFor || null,
            calendarEvent: attachment?.address ?? null,
          },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // A brand new Plan has no fence to lose, so `conflict` cannot happen
        // here; the union is narrowed rather than handled.
        if (result.view.outcome === "saved") {
          onPlansChange(result.view.plans);
          onAnnounce(`${trimmed} was added to your plans.`);
          onClose();
        }
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return (
    <form className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-4" onSubmit={submit}>
      {attachment ? <CalendarEventAttachment attachment={attachment} /> : null}

      <HouseholdEventPlanFields
        details={details}
        disabled={pending}
        ids={{
          title: `${fieldId}-title`,
          details: `${fieldId}-details`,
          plannedFor: `${fieldId}-planned-for`,
        }}
        invalid={Boolean(error)}
        onDetails={setDetails}
        onPlannedFor={setPlannedFor}
        onTitle={setTitle}
        plannedFor={plannedFor}
        title={title}
        titleRef={titleRef}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending || trimmed.length === 0}
          size="sm"
          type="submit"
        >
          {pending ? "Adding…" : "Add plan"}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={onClose}
          size="sm"
          type="button"
          variant="ghost"
        >
          Not now
        </Button>
      </div>

      {error ? <HouseholdEventPlanErrorText message={error} /> : null}
    </form>
  );
}
