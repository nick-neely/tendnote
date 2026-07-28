"use client";

import { useId, useState } from "react";
import { editSavedItemAction } from "@/app/actions/saved-items";
import { GeneralActionReminderField } from "@/components/general-action-reminder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
    ? item.reminderSchedule.kind === "relative"
      ? { kind: "relative" as const, leadMinutes: item.reminderSchedule.leadMinutes ?? 0 }
      : { kind: "exact" as const, localTime: item.reminderSchedule.localTime ?? "09:00" }
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
              const reminder = await saveSchedule("saved_item", item.id, "instant");
              if (!reminder.nextValidChoice) {
                view = { ...view, reminderSchedule: reminder.scheduleView };
              }
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
      <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium" htmlFor={bringBackAtId}>
        Bring back
        <Input
          aria-label="Edit bring-back time"
          id={bringBackAtId}
          onChange={(event) => {
            setBringBackAt(event.target.value);
            if (!event.target.value) setReminderEnabled(false);
          }}
          type="datetime-local"
          value={bringBackAt}
        />
      </label>
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
