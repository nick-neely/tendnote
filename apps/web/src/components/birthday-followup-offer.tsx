"use client";

import { CakeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBirthdayFollowupAction } from "@/app/actions/followups";
import { ReminderOptInInvitation } from "@/components/general-action-reminder";
import { ErrorText, GENERIC_ERROR } from "@/components/person-followup-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getReminderInstallationId } from "@/lib/reminder-registration";

export function BirthdayFollowupOffer({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<"day_of" | "week_before" | "custom">("day_of");
  const [customDays, setCustomDays] = useState(3);
  const [createdLabel, setCreatedLabel] = useState<string | null>(null);
  const [optInInstallationId, setOptInInstallationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-dashed bg-surface px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <CakeIcon className="mt-0.5 size-4 text-primary" />
        <div>
          <p className="text-sm font-medium">Create an annual birthday follow-up?</p>
          <p className="text-[length:var(--text-small)] text-muted-foreground">
            Saving a birthday doesn't remind you. This follow-up does.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Reminder schedule
          <select
            className="h-9 rounded-md border bg-background px-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => setChoice(event.target.value as typeof choice)}
            value={choice}
          >
            <option value="day_of">Day of at 9:00 AM</option>
            <option value="week_before">One week before</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {choice === "custom" ? (
          <div className="flex flex-col gap-1 text-sm">
            <span>Days before</span>
            <Input
              aria-label="Custom days before birthday"
              className="w-28"
              max={30}
              min={0}
              onChange={(event) => setCustomDays(Number(event.target.value))}
              type="number"
              value={customDays}
            />
          </div>
        ) : null}
        <Button
          disabled={pending || (choice === "custom" && (!customDays || customDays > 30))}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const clientInstallationId = getReminderInstallationId(window.localStorage);
                const leadMinutes =
                  choice === "day_of" ? 0 : choice === "week_before" ? 10_080 : customDays * 1_440;
                const result = await createBirthdayFollowupAction({
                  personId,
                  clientInstallationId,
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  schedule: { kind: "relative", leadMinutes },
                });
                setCreatedLabel(
                  `${result.view.reason} · ${result.view.reminderSchedule?.label ?? "Reminder saved"}`,
                );
                if (result.optIn.state === "offer") setOptInInstallationId(clientInstallationId);
                router.refresh();
              } catch {
                setError(GENERIC_ERROR);
              }
            });
          }}
          type="button"
        >
          {pending ? "Creating…" : `Create for ${personName}`}
        </Button>
      </div>
      {createdLabel ? <p className="text-sm text-muted-foreground">{createdLabel}</p> : null}
      {error ? <ErrorText message={error} /> : null}
      {optInInstallationId ? (
        <ReminderOptInInvitation
          clientInstallationId={optInInstallationId}
          onDismiss={() => setOptInInstallationId(null)}
        />
      ) : null}
    </div>
  );
}
