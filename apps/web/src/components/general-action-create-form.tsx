"use client";

import type { GeneralActionRecurrence } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { useState } from "react";
import { createGeneralActionAction } from "@/app/actions/general-actions";
import { AreaSelect } from "@/components/general-action-area-select";
import {
  ActionAssetHintsField,
  cleanHintLabels,
} from "@/components/general-action-asset-hints-field";
import {
  ActionLinksField,
  cleanLinks,
  type LinkDraft,
} from "@/components/general-action-links-field";
import {
  ActionPeopleField,
  type ActionPersonOption,
} from "@/components/general-action-people-field";
import { RecurrenceField } from "@/components/general-action-recurrence-field";
import {
  type GeneralActionReminderChoice,
  GeneralActionReminderField,
} from "@/components/general-action-reminder";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  AudiencePreview,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
import { ChevronDownIcon, PlusIcon } from "@/components/icons";
import { ReminderPastLeadRecovery } from "@/components/reminder-past-lead-recovery";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import { buildCreateActionInput } from "@/lib/general-action-create-input";
import type { GeneralActionView } from "@/lib/general-action-view";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";
import { usePendingMutationSubmit } from "@/lib/reversible-mutation";
import { useReminderScheduleWriter } from "@/lib/use-reminder-schedule-writer";

/**
 * Capture-first create surface for a private one-time Action. The title input is
 * always in reach so the common case — jot the action, hit enter — takes seconds
 * (DESIGN.md capture speed). A quiet "Add date, notes, or links" disclosure keeps
 * the richer fields available without cluttering the calm default. On success the
 * new Action is handed to the parent to lead the active list.
 */
// The expanded fields live in CreateActionDetails and the payload assembly in
// buildCreateActionInput; what remains is the capture-first form shell. Its cognitive score
// is the create-form's field-state hook set plus JSX depth, not branching logic (cyclomatic
// is trivial) — relocating the field state across the submit boundary would be a behavior
// change, not a structural cleanup.
// fallow-ignore-next-line complexity
export function CreateActionForm({
  onCreate,
  areas,
  defaultAreaId = null,
  shareableMembers = [],
  people = [],
  onDetailsRequested,
  detailsLoadError = null,
}: {
  onCreate: (view: GeneralActionView) => void;
  /** Active Areas the new Action can be filed under. */
  areas: GeneralActionAreaView[];
  /** Pre-file the new Action under the currently filtered Area, so it stays in view. */
  defaultAreaId?: string | null;
  /** Household members the Action can be shared with; empty keeps it private-only. */
  shareableMembers?: ShareableActionMember[];
  /** The owner's people, so an Action can link one as context (ADR 0155). */
  people?: ActionPersonOption[];
  /** Loads optional people/sharing/reminder choices only when details open. */
  onDetailsRequested?: () => void;
  /** A soft failure while loading optional detail choices; capture stays usable. */
  detailsLoadError?: string | null;
}) {
  const reminderWriter = useReminderScheduleWriter();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState<GeneralActionRecurrence | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderChoice, setReminderChoice] = useState<GeneralActionReminderChoice>({
    kind: "exact",
    localTime: "09:00",
  });
  const [pastLeadRecovery, setPastLeadRecovery] = useState<{
    actionId: string;
    recordKind: "general_action" | "routine";
    label: string;
  } | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [hintLabels, setHintLabels] = useState<string[]>([]);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [areaId, setAreaId] = useState<string | null>(defaultAreaId);
  const [visibilityChoice, setVisibilityChoice] = useState<VisibilityChoice>("only_me");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const { error, setError, pending, submit } = usePendingMutationSubmit(GENERIC_ERROR);

  const trimmedTitle = title.trim();
  const selectedMembersRequired =
    visibilityChoice === "selected_members" && selectedUserIds.length === 0;

  function reset() {
    setTitle("");
    setDueDate("");
    setRecurrence(null);
    setReminderEnabled(false);
    setReminderChoice({ kind: "exact", localTime: "09:00" });
    setNotes("");
    setLinks([]);
    setHintLabels([]);
    setPersonIds([]);
    setAreaId(defaultAreaId);
    setVisibilityChoice("only_me");
    setSelectedUserIds([]);
    setShowDetails(false);
    setError(null);
  }

  function submitAction() {
    if (!trimmedTitle || selectedMembersRequired) {
      return;
    }
    const payload = buildCreateActionInput({
      title: trimmedTitle,
      notes: notes.trim(),
      dueDate,
      recurrence,
      links: cleanLinks(links),
      assetHints: cleanHintLabels(hintLabels),
      personIds,
      areaId,
      visibilityChoice,
      selectedUserIds,
    });
    submit(
      () => createGeneralActionAction(payload),
      // One post-create transaction coordinates optional Reminder recovery and opt-in without
      // moving product policy out of the shared server operations; focused DOM tests cover it.
      // fallow-ignore-next-line complexity
      async (view) => {
        onCreate(view);
        let reminderError: string | null = null;
        if (reminderEnabled && dueDate) {
          try {
            const result = await reminderWriter.save(
              recurrence ? "routine" : "general_action",
              view.id,
              reminderChoice,
            );
            if (result.nextValidChoice) {
              setPastLeadRecovery({
                actionId: view.id,
                recordKind: recurrence ? "routine" : "general_action",
                label: result.nextValidChoice.label,
              });
            } else if (!result.occurrenceIntentCreated) {
              reminderError =
                "The action was saved, but that alert time has passed. Edit it to choose a future date or alert time.";
            } else {
              onCreate({
                ...view,
                reminderSchedule: toReminderScheduleView(result.schedule),
              });
            }
          } catch {
            reminderError =
              "The action was saved, but its reminder wasn't. Edit the action to set it again.";
          }
        }
        reset();
        if (reminderError) setError(reminderError);
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submitAction();
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label="What do you want to get done?"
            className="sm:flex-1"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What do you want to get done?"
            value={title}
          />
          <Button
            className="sm:self-auto"
            disabled={pending || !trimmedTitle || selectedMembersRequired}
            type="submit"
          >
            {pending ? <Spinner /> : <PlusIcon />}
            Add action
          </Button>
        </div>

        <Collapsible
          className="flex flex-col gap-3"
          onOpenChange={(open) => {
            if (open) onDetailsRequested?.();
            setShowDetails(open);
          }}
          open={showDetails}
        >
          <CollapsibleTrigger className="group/details inline-flex items-center gap-1 self-start rounded-md text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <ChevronDownIcon
              aria-hidden
              className="size-3.5 transition-transform group-data-[state=open]/details:rotate-180 motion-reduce:transition-none"
            />
            Add date, details, or sharing
          </CollapsibleTrigger>

          {detailsLoadError ? (
            <div className="flex items-center gap-2">
              <ErrorText message={detailsLoadError} />
              <Button onClick={onDetailsRequested} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : null}

          <CollapsibleContent>
            <CreateActionDetails
              areaId={areaId}
              areas={areas}
              dueDate={dueDate}
              hintLabels={hintLabels}
              links={links}
              notes={notes}
              onAreaChange={setAreaId}
              onDueDateChange={setDueDate}
              onHintLabelsChange={setHintLabels}
              onLinksChange={setLinks}
              onNotesChange={setNotes}
              onPersonIdsChange={setPersonIds}
              onRecurrenceChange={(value) => {
                setRecurrence(value);
                if (value && reminderChoice.kind === "exact") {
                  setReminderChoice({ kind: "relative", leadMinutes: 0 });
                }
              }}
              onReminderChoiceChange={setReminderChoice}
              onReminderEnabledChange={setReminderEnabled}
              onSelectedUserIdsChange={setSelectedUserIds}
              onVisibilityChange={setVisibilityChoice}
              people={people}
              personIds={personIds}
              recurrence={recurrence}
              reminderChoice={reminderChoice}
              reminderEnabled={reminderEnabled}
              selectedUserIds={selectedUserIds}
              shareableMembers={shareableMembers}
              visibilityChoice={visibilityChoice}
            />
          </CollapsibleContent>
        </Collapsible>

        {error ? <ErrorText message={error} /> : null}
      </form>
      {pastLeadRecovery ? (
        <ReminderPastLeadRecovery
          label={pastLeadRecovery.label}
          onRecover={async () => {
            setRecoveryPending(true);
            try {
              await reminderWriter.save(pastLeadRecovery.recordKind, pastLeadRecovery.actionId, {
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

/**
 * The expanded create-action fields, in two calm clusters so capture stays fast: the
 * "Details" of the action, then "Sharing" (only when a household exists). Grouping keeps
 * the expanded form from reading as one undifferentiated wall of fields.
 */
// A pure presentational panel (no hooks, cyclomatic 4). Its cognitive score is the depth of
// the two labeled field clusters; splitting them into micro-components would fragment the
// disclosure panel without reducing genuine complexity.
// fallow-ignore-next-line complexity
function CreateActionDetails({
  dueDate,
  recurrence,
  reminderEnabled,
  reminderChoice,
  notes,
  areas,
  areaId,
  links,
  people,
  personIds,
  hintLabels,
  shareableMembers,
  visibilityChoice,
  selectedUserIds,
  onDueDateChange,
  onRecurrenceChange,
  onReminderEnabledChange,
  onReminderChoiceChange,
  onNotesChange,
  onAreaChange,
  onLinksChange,
  onPersonIdsChange,
  onHintLabelsChange,
  onVisibilityChange,
  onSelectedUserIdsChange,
}: {
  dueDate: string;
  recurrence: GeneralActionRecurrence | null;
  reminderEnabled: boolean;
  reminderChoice: GeneralActionReminderChoice;
  notes: string;
  areas: GeneralActionAreaView[];
  areaId: string | null;
  links: LinkDraft[];
  people: ActionPersonOption[];
  personIds: string[];
  hintLabels: string[];
  shareableMembers: ShareableActionMember[];
  visibilityChoice: VisibilityChoice;
  selectedUserIds: string[];
  onDueDateChange: (value: string) => void;
  onRecurrenceChange: (value: GeneralActionRecurrence | null) => void;
  onReminderEnabledChange: (value: boolean) => void;
  onReminderChoiceChange: (value: GeneralActionReminderChoice) => void;
  onNotesChange: (value: string) => void;
  onAreaChange: (value: string | null) => void;
  onLinksChange: (value: LinkDraft[]) => void;
  onPersonIdsChange: (value: string[]) => void;
  onHintLabelsChange: (value: string[]) => void;
  onVisibilityChange: (value: VisibilityChoice) => void;
  onSelectedUserIdsChange: (value: string[]) => void;
}) {
  const householdNative = visibilityChoice === "whole_household";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <span className="text-[length:var(--text-small)] font-medium text-foreground">Details</span>
        <div className="flex flex-col gap-1.5">
          <span className="text-[length:var(--text-small)] text-muted-foreground">
            Due date (optional)
          </span>
          <DatePicker
            aria-label="Due date (optional)"
            className="w-full sm:w-48"
            onChange={onDueDateChange}
            value={dueDate}
          />
        </div>
        <RecurrenceField onChange={onRecurrenceChange} value={recurrence} />
        {dueDate ? (
          <GeneralActionReminderField
            allowCustomExactTime={!recurrence}
            choice={reminderChoice}
            enabled={reminderEnabled}
            onChoiceChange={onReminderChoiceChange}
            onEnabledChange={onReminderEnabledChange}
            relativeOnly={Boolean(recurrence)}
          />
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-[length:var(--text-small)] text-muted-foreground">Notes</span>
          <Textarea
            aria-label="Notes"
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Anything worth remembering: a model number, a phone number, what's left to do."
            rows={2}
            value={notes}
          />
        </div>
        {areas.length && !householdNative ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[length:var(--text-small)] text-muted-foreground">Area</span>
            <AreaSelect
              areas={areas}
              ariaLabel="Area"
              onChange={onAreaChange}
              triggerClassName="w-full sm:w-56"
              value={areaId}
            />
          </div>
        ) : null}
        <ActionLinksField links={links} onChange={onLinksChange} />
        {/* An Area and a person link are one member's own records, resolved against
            that member and invisible to everyone else — so a household action
            carries neither, and the fields go rather than sit there refusing. */}
        {householdNative ? null : (
          <ActionPeopleField onChange={onPersonIdsChange} people={people} selectedIds={personIds} />
        )}
        <ActionAssetHintsField labels={hintLabels} onChange={onHintLabelsChange} />
      </div>
      {shareableMembers.length ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <span className="text-[length:var(--text-small)] font-medium text-foreground">
            Sharing
          </span>
          <ActionVisibilityField
            members={shareableMembers}
            name="new-action-visibility"
            onChoiceChange={onVisibilityChange}
            onSelectedChange={onSelectedUserIdsChange}
            selectedUserIds={selectedUserIds}
            value={visibilityChoice}
          />
          {/* One line, stated once, because the difference is real and not
              recoverable later: choosing the household makes the record theirs
              rather than yours. Said plainly and left alone — not a warning, not a
              callout, and never repeated on the row afterwards (ADR 0214). */}
          {householdNative ? (
            <p className="text-[length:var(--text-small)] text-muted-foreground">
              This becomes the household's, not yours: everyone can edit it, and it stays if you
              leave.
            </p>
          ) : null}
          {visibilityChoice !== "only_me" ? (
            <AudiencePreview
              choice={visibilityChoice}
              householdSize={shareableMembers.length + 1}
              selectedCount={selectedUserIds.length}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
