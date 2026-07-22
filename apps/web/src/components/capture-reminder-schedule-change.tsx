"use client";

import type {
  ConversationalCaptureChangeTarget,
  ConversationalCaptureConfirmation,
  ConversationalCaptureOutcomeConfirmation,
} from "@tendnote/domain/conversational-capture";
import { useState } from "react";
import {
  type GeneralActionReminderChoice,
  GeneralActionReminderField,
} from "@/components/general-action-reminder";
import { Button } from "@/components/ui/button";
import { getReminderInstallationId } from "@/lib/reminder-registration";

type ChangeReminder = (input: {
  target: ConversationalCaptureChangeTarget;
  clientInstallationId: string;
  timeZone: string;
  schedule: GeneralActionReminderChoice;
}) => Promise<{ reminderSchedule: string }>;

function replaceOutcomeReminderSchedule(
  confirmation: ConversationalCaptureConfirmation,
  index: number,
  reminderSchedule: string,
): ConversationalCaptureConfirmation {
  const updateOutcome = (
    outcome: ConversationalCaptureOutcomeConfirmation,
  ): ConversationalCaptureOutcomeConfirmation => {
    if (!["Actions", "Routines", "Follow-Ups", "Saved Items"].includes(outcome.destination)) {
      return outcome;
    }
    return {
      ...outcome,
      interpreted: { ...outcome.interpreted, reminderSchedule },
    } as ConversationalCaptureOutcomeConfirmation;
  };
  return confirmation.destination === "Grouped"
    ? {
        ...confirmation,
        outcomes: confirmation.outcomes.map((outcome, outcomeIndex) =>
          outcomeIndex === index ? updateOutcome(outcome) : outcome,
        ),
      }
    : updateOutcome(confirmation);
}

export function CaptureReminderScheduleChange({
  changeReminder,
  confirmation,
  index,
  onConfirmationChange,
  outcome,
}: {
  changeReminder?: ChangeReminder;
  confirmation: ConversationalCaptureConfirmation;
  index: number;
  onConfirmationChange: (confirmation: ConversationalCaptureConfirmation) => void;
  outcome: ConversationalCaptureOutcomeConfirmation;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<GeneralActionReminderChoice>(
    outcome.destination === "Routines" || outcome.destination === "Saved Items"
      ? { kind: "relative", leadMinutes: 0 }
      : { kind: "exact", localTime: "09:00" },
  );
  if (!open) {
    return (
      <Button
        className="self-start"
        disabled={!changeReminder}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        Change reminder schedule
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3">
      <GeneralActionReminderField
        choice={choice}
        enabled
        instantRelative={outcome.destination === "Saved Items"}
        onChoiceChange={setChoice}
        onEnabledChange={() => {}}
        relativeOnly={outcome.destination === "Routines"}
      />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={pending || !changeReminder}
          onClick={async () => {
            if (!changeReminder) return;
            setPending(true);
            setError(null);
            try {
              const result = await changeReminder({
                target: outcome.change,
                clientInstallationId: getReminderInstallationId(window.localStorage),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                schedule: choice,
              });
              onConfirmationChange(
                replaceOutcomeReminderSchedule(confirmation, index, result.reminderSchedule),
              );
              setOpen(false);
            } catch {
              setError("Tendnote couldn't change that reminder schedule. Try again.");
            } finally {
              setPending(false);
            }
          }}
          size="sm"
          type="button"
        >
          {pending ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}
