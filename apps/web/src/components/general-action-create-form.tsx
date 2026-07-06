"use client";

import type { GeneralActionRecurrence } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
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

/**
 * Capture-first create surface for a private one-time Action. The title input is
 * always in reach so the common case — jot the action, hit enter — takes seconds
 * (DESIGN.md capture speed). A quiet "Add date, notes, or links" disclosure keeps
 * the richer fields available without cluttering the calm default. On success the
 * new Action is handed to the parent to lead the active list.
 */
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  function submit() {
    if (!trimmedTitle || selectedMembersRequired) {
      return;
    }
    const trimmedNotes = notes.trim();
    const cleanedLinks = cleanLinks(links);
    const cleanedHints = cleanHintLabels(hintLabels);
    setError(null);
    startTransition(async () => {
      try {
        const result = await createGeneralActionAction({
          title: trimmedTitle,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
          ...(dueDate ? { dueAt: dueDate } : {}),
          ...(recurrence ? { recurrence } : {}),
          ...(cleanedLinks.length ? { links: cleanedLinks } : {}),
          ...(cleanedHints.length ? { assetHints: cleanedHints } : {}),
          ...(personIds.length ? { personIds } : {}),
          ...(areaId ? { areaId } : {}),
          visibilityChoice,
          ...(selectedUserIds.length ? { selectedUserIds } : {}),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onCreate(result.view);
        reset();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
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
          // Two calm clusters so capture stays fast: the "Details" of the action, then
          // "Sharing" (only when a household exists). Grouping keeps the expanded form
          // from reading as one undifferentiated wall of fields.
          <div className="flex flex-col gap-4" id={detailsId}>
            <div className="flex flex-col gap-3">
              <span className="text-[length:var(--text-small)] font-medium text-foreground">
                Details
              </span>
              <div className="flex flex-col gap-1.5">
                <span className="text-[length:var(--text-small)] text-muted-foreground">
                  Due date (optional)
                </span>
                <Input
                  aria-label="Due date (optional)"
                  className="w-full sm:w-48"
                  onChange={(event) => setDueDate(event.target.value)}
                  type="date"
                  value={dueDate}
                />
              </div>
              <RecurrenceField onChange={setRecurrence} value={recurrence} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[length:var(--text-small)] text-muted-foreground">Notes</span>
                <Textarea
                  aria-label="Notes"
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Anything worth remembering — a model number, a phone number, what's left to do."
                  rows={2}
                  value={notes}
                />
              </div>
              {areas.length ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[length:var(--text-small)] text-muted-foreground">
                    Area
                  </span>
                  <AreaSelect
                    areas={areas}
                    ariaLabel="Area"
                    onChange={setAreaId}
                    triggerClassName="w-full sm:w-56"
                    value={areaId}
                  />
                </div>
              ) : null}
              <ActionLinksField links={links} onChange={setLinks} />
              <ActionPeopleField onChange={setPersonIds} people={people} selectedIds={personIds} />
              <ActionAssetHintsField labels={hintLabels} onChange={setHintLabels} />
            </div>
            {shareableMembers.length ? (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <span className="text-[length:var(--text-small)] font-medium text-foreground">
                  Sharing
                </span>
                <ActionVisibilityField
                  members={shareableMembers}
                  name="new-action-visibility"
                  onChoiceChange={setVisibilityChoice}
                  onSelectedChange={setSelectedUserIds}
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
        ) : null}
      </div>

      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}
