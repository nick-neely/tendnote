"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { createBirthdayFollowupAction } from "@/app/actions/followups";
import { CakeIcon } from "@/components/icons";
import { ErrorText, GENERIC_ERROR } from "@/components/person-followup-shared";
import {
  reminderInstallationIdentity,
  useReminderInstallation,
} from "@/components/reminder-installation-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BirthdayFollowupOffer({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const installation = useReminderInstallation();
  const router = useRouter();
  const scheduleFieldId = useId();
  const [choice, setChoice] = useState<"day_of" | "week_before" | "custom">("day_of");
  const [customDays, setCustomDays] = useState(3);
  const [createdLabel, setCreatedLabel] = useState<string | null>(null);
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
        {/* The trigger is a button, which `htmlFor` still names and activates, so
            the whole label stays the way into the chooser. */}
        <Label
          className="flex-col items-stretch gap-1 text-sm font-normal"
          htmlFor={scheduleFieldId}
        >
          Reminder schedule
          <Select onValueChange={(next) => setChoice(next as typeof choice)} value={choice}>
            <SelectTrigger className="min-w-44" id={scheduleFieldId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day_of">Day of at 9:00 AM</SelectItem>
              <SelectItem value="week_before">One week before</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </Label>
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
                if (!installation) throw new Error("Reminder installation identity is loading.");
                const leadMinutes =
                  choice === "day_of" ? 0 : choice === "week_before" ? 10_080 : customDays * 1_440;
                const result = await createBirthdayFollowupAction({
                  personId,
                  ...reminderInstallationIdentity(installation),
                  schedule: { kind: "relative", leadMinutes },
                });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setCreatedLabel(
                  `${result.view.view.reason} · ${result.view.view.reminderSchedule?.label ?? "Reminder saved"}`,
                );
                if (result.view.optIn.state === "offer") installation.offerReminderOptIn();
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
    </div>
  );
}
