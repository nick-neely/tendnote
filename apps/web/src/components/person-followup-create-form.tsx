import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { useState, useTransition } from "react";
import { createFollowupAction } from "@/app/actions/followups";
import { GeneralActionReminderField } from "@/components/general-action-reminder";
import { PlusIcon } from "@/components/icons";
import { ErrorText, GENERIC_ERROR } from "@/components/person-followup-shared";
import { ReminderPastLeadRecovery } from "@/components/reminder-past-lead-recovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VisibilityChoiceControl } from "@/components/visibility-choice-control";
import type { FollowupView } from "@/lib/followup-view";
import { useReminderSchedule } from "@/lib/use-reminder-schedule";
import { useReminderScheduleWriter } from "@/lib/use-reminder-schedule-writer";

export type ShareableHouseholdMember = {
  userId: string;
  name: string;
  email: string;
};

/**
 * Collapsed "New follow-up" affordance that expands into an inline create form,
 * so adding a reminder stays on the person's ledger without a modal. On success
 * the new reminder is handed to the parent to join the active list.
 */
// The branches below are the single create transaction's optional Reminder and audience fields;
// keeping them co-located prevents partial Follow-Up creation state. DOM coverage exercises the
// past-alert recovery path and static coverage pins visibility variants.
// fallow-ignore-next-line complexity
export function CreateFollowupForm({
  personId,
  firstName,
  defaultDueDate,
  shareableMembers = [],
  onCreate,
}: {
  personId: string;
  firstName: string;
  defaultDueDate: string;
  shareableMembers?: ShareableHouseholdMember[];
  onCreate: (view: FollowupView) => void;
}) {
  const reminderWriter = useReminderScheduleWriter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [visibilityChoice, setVisibilityChoice] = useState<VisibilityChoice>("only_me");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const {
    choice: reminderChoice,
    enabled: reminderEnabled,
    reset: resetReminder,
    save: saveSchedule,
    setChoice: setReminderChoice,
    setEnabled: setReminderEnabled,
  } = useReminderSchedule();
  const [error, setError] = useState<string | null>(null);
  const [pastLeadRecovery, setPastLeadRecovery] = useState<{
    label: string;
    recordId: string;
  } | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [pending, startTransition] = useTransition();

  const trimmedReason = reason.trim();
  const selectedMembersRequired =
    visibilityChoice === "selected_members" && selectedUserIds.length === 0;

  function reset() {
    setReason("");
    setDueDate(defaultDueDate);
    setVisibilityChoice("only_me");
    setSelectedUserIds([]);
    resetReminder();
    setError(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          className="self-start"
          onClick={() => setOpen(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon />
          New follow-up
        </Button>
        {error ? <ErrorText message={error} /> : null}
        {pastLeadRecovery ? (
          <ReminderPastLeadRecovery
            label={pastLeadRecovery.label}
            onRecover={async () => {
              setRecoveryPending(true);
              try {
                await reminderWriter.save("follow_up", pastLeadRecovery.recordId, {
                  kind: "relative",
                  leadMinutes: 0,
                });
                setPastLeadRecovery(null);
              } finally {
                setRecoveryPending(false);
              }
            }}
            pending={recoveryPending}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <form
        className="flex flex-col gap-2.5 rounded-xl border border-dashed bg-surface px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedReason || !dueDate || selectedMembersRequired) {
            return;
          }
          setError(null);
          startTransition(async () => {
            try {
              const created = await createFollowupAction({
                personId,
                reason: trimmedReason,
                dueAt: dueDate,
                visibilityChoice,
                selectedUserIds,
              });
              if (!created.ok) {
                setError(created.error);
                return;
              }
              let view = created.view;
              if (reminderEnabled) {
                const reminder = await saveSchedule("follow_up", created.view.id);
                if (reminder.nextValidChoice) {
                  onCreate(created.view);
                  reset();
                  setPastLeadRecovery({
                    label: reminder.nextValidChoice.label,
                    recordId: created.view.id,
                  });
                  return;
                }
                view = {
                  ...created.view,
                  reminderSchedule: reminder.scheduleView,
                };
              }
              onCreate(view);
              reset();
            } catch {
              setError(GENERIC_ERROR);
            }
          });
        }}
      >
        <Input
          aria-label={`Why follow up with ${firstName}?`}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
          placeholder={`Why follow up with ${firstName}?`}
          value={reason}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Input
            aria-label="Due date"
            className="w-44"
            onChange={(event) => setDueDate(event.target.value)}
            type="date"
            value={dueDate}
          />
          <div className="flex items-center gap-1.5">
            <Button onClick={reset} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={pending || !trimmedReason || !dueDate || selectedMembersRequired}
              size="sm"
              type="submit"
            >
              Add follow-up
            </Button>
          </div>
        </div>
        <GeneralActionReminderField
          choice={reminderChoice}
          enabled={reminderEnabled}
          onChoiceChange={setReminderChoice}
          onEnabledChange={setReminderEnabled}
        />
        {shareableMembers.length ? (
          <>
            <VisibilityChoiceControl
              name={`followup-visibility-${personId}`}
              onChoiceChange={(choice) => {
                setVisibilityChoice(choice);
                if (choice !== "selected_members") {
                  setSelectedUserIds([]);
                }
              }}
              value={visibilityChoice}
            />
            {visibilityChoice === "selected_members" ? (
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium text-foreground">Share with</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {shareableMembers.map((member) => (
                    <label
                      className="flex min-h-16 cursor-pointer items-center gap-2 rounded-md border border-border bg-card p-3 text-sm transition-colors hover:border-primary/45 has-checked:border-primary has-checked:bg-secondary"
                      key={member.userId}
                    >
                      <input
                        checked={selectedUserIds.includes(member.userId)}
                        className="size-4 accent-primary"
                        onChange={(event) => {
                          setSelectedUserIds((current) =>
                            event.target.checked
                              ? [...current, member.userId]
                              : current.filter((userId) => userId !== member.userId),
                          );
                        }}
                        type="checkbox"
                        value={member.userId}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {member.name}
                        </span>
                        <span className="block truncate text-muted-foreground text-xs">
                          {member.email}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </>
        ) : null}
        {error ? <ErrorText message={error} /> : null}
      </form>
    </div>
  );
}
