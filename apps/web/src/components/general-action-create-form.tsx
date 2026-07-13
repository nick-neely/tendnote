"use client";

import type { GeneralActionRecurrence } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
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
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  AudiencePreview,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import type { GeneralActionView } from "@/lib/general-action-view";
import { useMutationSubmit } from "@/lib/use-mutation-submit";

/**
 * Assembles the create-action server-action payload, including only the optional fields the
 * user actually filled in (an empty note, no date, no links, and so on are simply omitted).
 * Kept a pure function so the submit handler stays a flat try/await/handle flow.
 */
function buildCreateActionInput(fields: {
  title: string;
  notes: string;
  dueDate: string;
  recurrence: GeneralActionRecurrence | null;
  links: ReturnType<typeof cleanLinks>;
  assetHints: ReturnType<typeof cleanHintLabels>;
  personIds: string[];
  areaId: string | null;
  visibilityChoice: VisibilityChoice;
  selectedUserIds: string[];
}): Parameters<typeof createGeneralActionAction>[0] {
  return {
    title: fields.title,
    ...(fields.notes ? { notes: fields.notes } : {}),
    ...(fields.dueDate ? { dueAt: fields.dueDate } : {}),
    ...(fields.recurrence ? { recurrence: fields.recurrence } : {}),
    ...(fields.links.length ? { links: fields.links } : {}),
    ...(fields.assetHints.length ? { assetHints: fields.assetHints } : {}),
    ...(fields.personIds.length ? { personIds: fields.personIds } : {}),
    ...(fields.areaId ? { areaId: fields.areaId } : {}),
    visibilityChoice: fields.visibilityChoice,
    ...(fields.selectedUserIds.length ? { selectedUserIds: fields.selectedUserIds } : {}),
  };
}

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
}) {
  const detailsId = useId();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState<GeneralActionRecurrence | null>(null);
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [hintLabels, setHintLabels] = useState<string[]>([]);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [areaId, setAreaId] = useState<string | null>(defaultAreaId);
  const [visibilityChoice, setVisibilityChoice] = useState<VisibilityChoice>("only_me");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const { error, setError, pending, submit } = useMutationSubmit(GENERIC_ERROR);

  const trimmedTitle = title.trim();
  const selectedMembersRequired =
    visibilityChoice === "selected_members" && selectedUserIds.length === 0;

  function reset() {
    setTitle("");
    setDueDate("");
    setRecurrence(null);
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
      (view) => {
        onCreate(view);
        reset();
      },
    );
  }

  return (
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

      <div className="flex flex-col gap-3">
        <button
          aria-controls={detailsId}
          aria-expanded={showDetails}
          className="inline-flex items-center gap-1 self-start rounded-md text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setShowDetails((open) => !open)}
          type="button"
        >
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 transition-transform data-[open=true]:rotate-180 motion-reduce:transition-none"
            data-open={showDetails}
          />
          Add date, details, or sharing
        </button>

        {showDetails ? (
          <CreateActionDetails
            areaId={areaId}
            areas={areas}
            detailsId={detailsId}
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
            onRecurrenceChange={setRecurrence}
            onSelectedUserIdsChange={setSelectedUserIds}
            onVisibilityChange={setVisibilityChoice}
            people={people}
            personIds={personIds}
            recurrence={recurrence}
            selectedUserIds={selectedUserIds}
            shareableMembers={shareableMembers}
            visibilityChoice={visibilityChoice}
          />
        ) : null}
      </div>

      {error ? <ErrorText message={error} /> : null}
    </form>
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
  detailsId,
  dueDate,
  recurrence,
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
  onNotesChange,
  onAreaChange,
  onLinksChange,
  onPersonIdsChange,
  onHintLabelsChange,
  onVisibilityChange,
  onSelectedUserIdsChange,
}: {
  detailsId: string;
  dueDate: string;
  recurrence: GeneralActionRecurrence | null;
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
  onNotesChange: (value: string) => void;
  onAreaChange: (value: string | null) => void;
  onLinksChange: (value: LinkDraft[]) => void;
  onPersonIdsChange: (value: string[]) => void;
  onHintLabelsChange: (value: string[]) => void;
  onVisibilityChange: (value: VisibilityChoice) => void;
  onSelectedUserIdsChange: (value: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-4" id={detailsId}>
      <div className="flex flex-col gap-3">
        <span className="text-[length:var(--text-small)] font-medium text-foreground">Details</span>
        <div className="flex flex-col gap-1.5">
          <span className="text-[length:var(--text-small)] text-muted-foreground">
            Due date (optional)
          </span>
          <Input
            aria-label="Due date (optional)"
            className="w-full sm:w-48"
            onChange={(event) => onDueDateChange(event.target.value)}
            type="date"
            value={dueDate}
          />
        </div>
        <RecurrenceField onChange={onRecurrenceChange} value={recurrence} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[length:var(--text-small)] text-muted-foreground">Notes</span>
          <Textarea
            aria-label="Notes"
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Anything worth remembering — a model number, a phone number, what's left to do."
            rows={2}
            value={notes}
          />
        </div>
        {areas.length ? (
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
        <ActionPeopleField onChange={onPersonIdsChange} people={people} selectedIds={personIds} />
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
