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
import {
  reminderInstallationIdentity,
  useReminderInstallation,
} from "@/components/reminder-installation-context";
import {
  pastExactReminderTimeMessage,
  pastReminderLeadTimeMessage,
} from "@/components/reminder-past-lead-recovery";
import { Button } from "@/components/ui/button";
import { type OwnerActionResult, unwrapOwnerActionResult } from "@/lib/owner-action-result";

export type CaptureReminderChangeResult = {
  reminderSchedule: string;
  reminderScheduleChoice: GeneralActionReminderChoice;
  reminderOptInOffered?: boolean;
  occurrenceIntentCreated: boolean;
  nextValidChoice: { label: string } | null;
};

export type CaptureReminderChange = (input: {
  target: ConversationalCaptureChangeTarget;
  clientInstallationId: string;
  timeZone: string;
  schedule: GeneralActionReminderChoice;
}) => Promise<OwnerActionResult<CaptureReminderChangeResult>>;

function initialReminderChoice(
  outcome: ConversationalCaptureOutcomeConfirmation,
): GeneralActionReminderChoice {
  if (outcome.destination === "Routines" || outcome.destination === "Saved Items") {
    return { kind: "relative", leadMinutes: 0 };
  }
  return outcome.destination === "Actions" && outcome.interpreted.reminderScheduleChoice
    ? outcome.interpreted.reminderScheduleChoice
    : { kind: "exact", localTime: "09:00" };
}

function replaceOutcomeReminderSchedule(
  confirmation: ConversationalCaptureConfirmation,
  index: number,
  reminderSchedule: string,
  reminderScheduleChoice: GeneralActionReminderChoice,
): ConversationalCaptureConfirmation {
  const updateOutcome = (
    outcome: ConversationalCaptureOutcomeConfirmation,
  ): ConversationalCaptureOutcomeConfirmation => {
    if (!outcome.change.kind.startsWith("edit_")) {
      return outcome;
    }
    return {
      ...outcome,
      interpreted: { ...outcome.interpreted, reminderSchedule, reminderScheduleChoice },
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
  changeReminder?: CaptureReminderChange;
  confirmation: ConversationalCaptureConfirmation;
  index: number;
  onConfirmationChange: (confirmation: ConversationalCaptureConfirmation) => void;
  outcome: ConversationalCaptureOutcomeConfirmation;
}) {
  const installation = useReminderInstallation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<GeneralActionReminderChoice>(() =>
    initialReminderChoice(outcome),
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
        allowCustomExactTime={outcome.destination === "Actions"}
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
              if (!installation) throw new Error("Reminder installation identity is loading.");
              const result = unwrapOwnerActionResult(
                await changeReminder({
                  target: outcome.change,
                  ...reminderInstallationIdentity(installation),
                  schedule: choice,
                }),
              );
              if (result.reminderOptInOffered) installation.offerReminderOptIn();
              if (result.nextValidChoice) {
                setChoice({ kind: "relative", leadMinutes: 0 });
                setError(pastReminderLeadTimeMessage(result.nextValidChoice.label));
                return;
              }
              if (result.occurrenceIntentCreated === false) {
                setError(pastExactReminderTimeMessage);
                return;
              }
              onConfirmationChange(
                replaceOutcomeReminderSchedule(
                  confirmation,
                  index,
                  result.reminderSchedule,
                  result.reminderScheduleChoice,
                ),
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
