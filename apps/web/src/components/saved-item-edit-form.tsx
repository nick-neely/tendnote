"use client";

import { useId, useState } from "react";
import { editSavedItemAction } from "@/app/actions/saved-items";
import { GeneralActionReminderField } from "@/components/general-action-reminder";
import { pastReminderLeadTimeMessage } from "@/components/reminder-past-lead-recovery";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toReminderScheduleChoice } from "@/lib/reminder-schedule-view";
import type { SavedItemView } from "@/lib/saved-item-view";
import { useReminderSchedule } from "@/lib/use-reminder-schedule";

function toDateTimeLocalValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

// This focused editor intentionally keeps its controlled field and Reminder branches together;
// splitting them would duplicate one atomic submit transaction across components. DOM coverage
// exercises details-only, Reminder, and clear paths.
// fallow-ignore-next-line complexity
export function SavedItemEditForm({
  item,
  onCancel,
  onSave,
  pending,
}: {
  item: SavedItemView;
  onCancel: () => void;
  onSave: (
    run: () => ReturnType<typeof editSavedItemAction>,
    focusTarget: HTMLElement | null,
  ) => void;
  pending: boolean;
}) {
  const bringBackAtId = useId();
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const [bringBackAt, setBringBackAt] = useState(toDateTimeLocalValue(item.bringBackAt));
  const {
    choice: reminderChoice,
    clear: clearSchedule,
    enabled: reminderEnabled,
    save: saveSchedule,
    setChoice: setReminderChoice,
    setEnabled: setReminderEnabled,
  } = useReminderSchedule(item.reminderSchedule);
  const detailsChanged =
    title.trim() !== item.title ||
    (content.trim() || null) !== item.content ||
    (item.kind === "link" && (url.trim() || null) !== item.url) ||
    bringBackAt !== toDateTimeLocalValue(item.bringBackAt);
  const currentReminderChoice = item.reminderSchedule
    ? toReminderScheduleChoice(item.reminderSchedule)
    : null;
  const reminderChanged =
    reminderEnabled !== Boolean(item.reminderSchedule) ||
    JSON.stringify(reminderChoice) !== JSON.stringify(currentReminderChoice);
  const hasChange = detailsChanged || reminderChanged;
  return (
    <form
      className="ml-7 flex flex-col gap-2 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !hasChange) return;
        onSave(
          async () => {
            const result = detailsChanged
              ? await editSavedItemAction({
                  savedItemId: item.id,
                  title: title.trim(),
                  content: content.trim() || null,
                  bringBackAt: bringBackAt || null,
                  ...(item.kind === "link" ? { url: url.trim() || null } : {}),
                })
              : { ok: true as const, view: item };
            if (!result.ok) return result;
            let view = result.view;
            if (reminderEnabled && bringBackAt) {
              const reminder = await saveSchedule("saved_item", item.id);
              if (reminder.nextValidChoice) {
                setReminderChoice({
                  kind: "relative",
                  leadMinutes: reminder.nextValidChoice.leadMinutes,
                });
                return {
                  ok: false as const,
                  error: pastReminderLeadTimeMessage(reminder.nextValidChoice.label),
                };
              }
              view = { ...view, reminderSchedule: reminder.scheduleView };
            } else if (item.reminderSchedule) {
              await clearSchedule("saved_item", item.id);
              view = { ...view, reminderSchedule: null };
            }
            return { ok: true as const, view };
          },
          event.nativeEvent.submitter instanceof HTMLElement ? event.nativeEvent.submitter : null,
        );
      }}
    >
      <Input
        aria-label="Edit title"
        onChange={(event) => setTitle(event.target.value)}
        value={title}
      />
      {item.kind === "link" ? (
        <Input aria-label="Edit URL" onChange={(event) => setUrl(event.target.value)} value={url} />
      ) : null}
      <Textarea
        aria-label="Edit details"
        onChange={(event) => setContent(event.target.value)}
        rows={2}
        value={content}
      />
      {/* The label sits beside the picker rather than wrapping it: a wrapping label folds
          the time input's own name into the date trigger's. Both halves keep the "Edit"
          naming the single field had, so they stay distinct from the capture form's copy
          of this field sitting above the row. */}
      <div className="flex max-w-xs flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor={bringBackAtId}>
          Bring back
        </label>
        <DateTimePicker
          aria-label="Edit bring-back date"
          id={bringBackAtId}
          onChange={(value) => {
            setBringBackAt(value);
            if (!value) setReminderEnabled(false);
          }}
          timeLabel="Edit bring-back time"
          value={bringBackAt}
        />
      </div>
      {bringBackAt ? (
        <GeneralActionReminderField
          choice={reminderChoice}
          enabled={reminderEnabled}
          instantRelative
          onChoiceChange={setReminderChoice}
          onEnabledChange={setReminderEnabled}
        />
      ) : null}
      <div className="flex gap-2">
        <Button disabled={pending || !title.trim() || !hasChange} size="sm" type="submit">
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
    </form>
  );
}
