"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  editHouseholdSavedItemAction,
  editSavedItemAction,
  getHouseholdSavedItemViewAction,
} from "@/app/actions/saved-items";
import { GeneralActionReminderField } from "@/components/general-action-reminder";
import { pastReminderLeadTimeMessage } from "@/components/reminder-past-lead-recovery";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toReminderScheduleChoice } from "@/lib/reminder-schedule-view";
import type { ReversibleMutationLabels } from "@/lib/reversible-mutation";
import type { SavedItemConflictView } from "@/lib/saved-item-conflict";
import {
  type SavedItemMemberNames,
  type SavedItemMutationResult,
  type SavedItemView,
  savedItemMemberLabel,
} from "@/lib/saved-item-view";
import { useReminderSchedule } from "@/lib/use-reminder-schedule";

export type SavedItemEditSave = (
  run: () => Promise<SavedItemMutationResult>,
  focusTarget: HTMLElement | null,
  labels?: Partial<ReversibleMutationLabels>,
) => void;

function toDateTimeLocalValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

// This focused editor intentionally keeps its controlled field and Reminder branches together;
// splitting them would duplicate one atomic submit transaction across components. DOM coverage
// exercises details-only, Reminder, clear, and household conflict paths.
// fallow-ignore-next-line complexity
export function SavedItemEditForm({
  item,
  memberNames,
  onCancel,
  onSave,
  pending,
}: {
  item: SavedItemView;
  memberNames: SavedItemMemberNames;
  onCancel: () => void;
  onSave: SavedItemEditSave;
  pending: boolean;
}) {
  const bringBackAtId = useId();
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const [bringBackAt, setBringBackAt] = useState(toDateTimeLocalValue(item.bringBackAt));
  const [conflict, setConflict] = useState<SavedItemConflictView | null>(null);
  const {
    choice: reminderChoice,
    clear: clearSchedule,
    enabled: reminderEnabled,
    save: saveSchedule,
    setChoice: setReminderChoice,
    setEnabled: setReminderEnabled,
  } = useReminderSchedule(item.reminderSchedule);
  const householdNative = item.ownership === "household_native";
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

  function saveDetails(replace: boolean) {
    const edit = {
      savedItemId: item.id,
      title: title.trim(),
      content: content.trim() || null,
      bringBackAt: bringBackAt || null,
      ...(item.kind === "link" ? { url: url.trim() || null } : {}),
    };
    if (!householdNative) return editSavedItemAction(edit);
    return editHouseholdSavedItemAction({
      ...edit,
      // Sent on an ordinary save so a stale write is refused rather than merged
      // or silently won; omitted only once the member has read the current value
      // and chosen to replace it (ADR 0209).
      ...(replace ? {} : { expectedVersion: item.version }),
    });
  }

  function submitEdit(replace: boolean, focusTarget: HTMLElement | null) {
    onSave(async () => {
      const result = detailsChanged
        ? await saveDetails(replace)
        : { ok: true as const, view: item };
      if (!result.ok) {
        if (!result.savedItemConflict) return result;
        // The draft stays in the fields; the panel above them takes the message,
        // the value that actually landed, and the two answers to it. The row's
        // generic error line is left empty rather than repeating that sentence
        // somewhere it cannot be acted on.
        setConflict(result.savedItemConflict);
        return { ok: false as const, error: "" };
      }
      setConflict(null);
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
    }, focusTarget);
  }

  /** Discard the draft and adopt what is stored, read back from the server rather than assembled here. */
  function takeTheirs(focusTarget: HTMLElement | null) {
    onSave(() => getHouseholdSavedItemViewAction({ savedItemId: item.id }), focusTarget, {
      pending: "Loading the current version…",
      success: "Showing the current version.",
    });
  }

  return (
    <form
      className="ml-7 flex flex-col gap-2 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !hasChange) return;
        submitEdit(
          false,
          event.nativeEvent.submitter instanceof HTMLElement ? event.nativeEvent.submitter : null,
        );
      }}
    >
      {conflict ? (
        // Keyed on the version so a second, newer refusal is a fresh panel: it
        // takes focus again rather than silently replacing its text under a
        // member who is looking at the buttons.
        <SavedItemConflictNotice
          conflict={conflict}
          key={conflict.version}
          memberNames={memberNames}
          onKeepMine={(focusTarget) => submitEdit(true, focusTarget)}
          onTakeTheirs={takeTheirs}
          pending={pending}
        />
      ) : null}
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
        <Label className="text-sm" htmlFor={bringBackAtId}>
          Bring back
        </Label>
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
        {/* While a conflict is open the two explicit answers replace Save: an
            ordinary save would resubmit the same stale version and refuse again. */}
        {conflict ? null : (
          <Button disabled={pending || !title.trim() || !hasChange} size="sm" type="submit">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        )}
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * What a member sees when someone else saved first.
 *
 * Their draft is untouched in the fields below; this sits above it holding the
 * value that actually landed and the two answers to it. No merge, no
 * last-write-wins, and no fault - writing at the same time as a housemate is an
 * ordinary thing to do, so the panel is a quiet panel and not a warning
 * (DESIGN.md §2, ADR 0209).
 *
 * It takes focus when it opens, and again whenever a newer value arrives. Save
 * changes - what the member last pressed - is gone by then, replaced by the two
 * answers, so focus had nowhere to return to and was landing on the document.
 * The container takes it rather than a button, so the explanation is heard
 * before the choice it belongs to.
 */
function SavedItemConflictNotice({
  conflict,
  memberNames,
  onKeepMine,
  onTakeTheirs,
  pending,
}: {
  conflict: SavedItemConflictView;
  memberNames: SavedItemMemberNames;
  onKeepMine: (focusTarget: HTMLElement | null) => void;
  onTakeTheirs: (focusTarget: HTMLElement | null) => void;
  pending: boolean;
}) {
  const explanationId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Mount only, and the caller keys this panel by version so a newer refusal is
  // a new mount. A ref callback would re-fire on every render and pull focus out
  // of whichever answer the member had just pressed.
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div
      aria-labelledby={explanationId}
      className="flex flex-col gap-2 rounded-md border bg-panel px-3 py-2.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      ref={panel}
      role="status"
      tabIndex={-1}
    >
      <p
        className="text-[length:var(--text-small)] leading-[var(--text-small-line)]"
        id={explanationId}
      >
        Someone else changed this while you were writing. Your draft is kept below.
      </p>
      <div className="flex flex-col gap-0.5">
        <span className="text-[length:var(--text-caption)] text-muted-foreground">
          Saved on this item now
        </span>
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
          {conflict.title}
        </p>
        {conflict.content ? (
          <p className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {conflict.content}
          </p>
        ) : null}
        {conflict.lastActorUserId ? (
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            Last changed by {savedItemMemberLabel(conflict.lastActorUserId, memberNames)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          aria-busy={pending}
          disabled={pending}
          onClick={(event) => onKeepMine(event.currentTarget)}
          size="sm"
          type="button"
        >
          {pending ? "Saving…" : "Keep mine"}
        </Button>
        <Button
          aria-busy={pending}
          disabled={pending}
          onClick={(event) => onTakeTheirs(event.currentTarget)}
          size="sm"
          type="button"
          variant="outline"
        >
          Take theirs
        </Button>
      </div>
    </div>
  );
}
