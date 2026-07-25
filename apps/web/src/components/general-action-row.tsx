"use client";

import {
  type GeneralActionLink,
  type GeneralActionRecurrence,
  nextRoutineDueAt,
} from "@tendnote/domain/general-actions";
import { type VisibilityChoice, visibilityChoiceForScope } from "@tendnote/domain/privacy";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  archiveGeneralActionAction,
  completeGeneralActionAction,
  deferGeneralActionAction,
  dismissGeneralActionAction,
  editGeneralActionAction,
  pauseGeneralActionAction,
  reopenGeneralActionAction,
  restoreGeneralActionAction,
  resumeGeneralActionAction,
  setGeneralActionPeopleAction,
  setGeneralActionVisibilityAction,
  skipGeneralActionOccurrenceAction,
  undeferGeneralActionAction,
  undoRoutineOccurrenceAction,
} from "@/app/actions/general-actions";
import { clearReminderAction, saveReminderAction } from "@/app/actions/reminders";
import { AreaSelect } from "@/components/general-action-area-select";
import {
  ActionAssetHintsField,
  cleanHintLabels,
  toHintLabels,
} from "@/components/general-action-asset-hints-field";
import { ActionContextStrip } from "@/components/general-action-context-strip";
import { ActionHistoryDialog } from "@/components/general-action-history-dialog";
import {
  ActionLinksField,
  cleanLinks,
  type LinkDraft,
  toLinkDrafts,
} from "@/components/general-action-links-field";
import {
  ActionPeopleField,
  type ActionPersonOption,
} from "@/components/general-action-people-field";
import { RecurrenceField } from "@/components/general-action-recurrence-field";
import {
  type GeneralActionReminderChoice,
  GeneralActionReminderField,
  ReminderOptInInvitation,
} from "@/components/general-action-reminder";
import { ActionDueChip, ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  AudiencePreview,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
import {
  ArchiveIcon,
  BellIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  HistoryIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  SkipForwardIcon,
  UsersIcon,
  XIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import type { GeneralActionMutationResult, GeneralActionView } from "@/lib/general-action-view";
import { getReminderInstallationId } from "@/lib/reminder-registration";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";

function linkLabel(link: GeneralActionLink): string {
  if (link.label) {
    return link.label;
  }
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}

function ActionLinks({ links }: { links: GeneralActionLink[] }) {
  if (!links.length) {
    return null;
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {links.map((link) => (
        <li key={link.url}>
          <a
            className="inline-flex max-w-[24ch] items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[length:var(--text-caption)] text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground"
            href={link.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{linkLabel(link)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function normalizeLinks(links: GeneralActionLink[]): string {
  return JSON.stringify(links.map((link) => ({ url: link.url, label: link.label ?? undefined })));
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function sameRecurrence(
  a: GeneralActionRecurrence | null,
  b: GeneralActionRecurrence | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.interval === b.interval && a.unit === b.unit;
}

/** Short calendar label ("Aug 12") for the roll-forward confirmation. */
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Shared in-place mutation transition for an Action's inline forms (edit/defer/share): runs
 * the server action, keeps the form open with a message on a validation failure, and on
 * success hands the updated view to the parent and returns the row to view mode. The three
 * forms own their own field state but share this submit/return contract.
 */
function useInPlaceActionUpdate(onUpdate: (view: GeneralActionView) => void, onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(
    run: () => Promise<GeneralActionMutationResult>,
    optimistic?: GeneralActionView,
    rollback?: GeneralActionView,
  ) {
    setError(null);
    setSaving(true);
    if (optimistic) onUpdate(optimistic);
    startTransition(async () => {
      try {
        const result = await run();
        if (!result.ok) {
          setError(result.error);
          setSaving(false);
          if (rollback) onUpdate(rollback);
          return;
        }
        onUpdate(result.view);
        onDone();
      } catch {
        setError(GENERIC_ERROR);
        setSaving(false);
        if (rollback) onUpdate(rollback);
      }
    });
  }

  return { error, saving, pending, submit };
}

/**
 * Owner-only content edit: title, notes, due date, cadence, Area, links, people, and asset
 * hints. Only fields the owner actually changed are sent; content and people links flow
 * through their separate lifecycle mutations, applied in order so the row reflects both.
 */
// fallow-ignore-next-line complexity
function ActionEditForm({
  action,
  areas,
  areaName,
  people,
  onUpdate,
  onCancel,
  onReminderOptIn,
}: {
  action: GeneralActionView;
  areas: GeneralActionAreaView[];
  areaName: string | null;
  people: ActionPersonOption[];
  onUpdate: (view: GeneralActionView) => void;
  onCancel: () => void;
  onReminderOptIn: (clientInstallationId: string) => void;
}) {
  const [title, setTitle] = useState(action.title);
  const [notes, setNotes] = useState(action.notes ?? "");
  const [dueDate, setDueDate] = useState(action.dueAtDate);
  const [recurrence, setRecurrence] = useState<GeneralActionRecurrence | null>(action.recurrence);
  const [reminderEnabled, setReminderEnabled] = useState(Boolean(action.reminderSchedule));
  const [reminderChoice, setReminderChoice] = useState<GeneralActionReminderChoice>(() =>
    action.reminderSchedule?.kind === "relative"
      ? { kind: "relative", leadMinutes: action.reminderSchedule.leadMinutes ?? 0 }
      : { kind: "exact", localTime: action.reminderSchedule?.localTime ?? "09:00" },
  );
  const [links, setLinks] = useState<LinkDraft[]>(toLinkDrafts(action.links));
  const [hintLabels, setHintLabels] = useState<string[]>(toHintLabels(action.assetHints));
  const [personIds, setPersonIds] = useState<string[]>(action.linkedPeople.map((p) => p.id));
  const [areaId, setAreaId] = useState<string | null>(action.areaId);
  const { error, saving, pending, submit } = useInPlaceActionUpdate(onUpdate, onCancel);

  const trimmedTitle = title.trim();
  const trimmedNotes = notes.trim();
  const cleanedLinks = cleanLinks(links);
  const cleanedHints = cleanHintLabels(hintLabels);
  const edit: {
    title?: string;
    notes?: string | null;
    dueAt?: string | null;
    recurrence?: GeneralActionRecurrence | null;
    links?: GeneralActionLink[];
    assetHints?: string[];
    areaId?: string | null;
  } = {};
  if (trimmedTitle && trimmedTitle !== action.title) {
    edit.title = trimmedTitle;
  }
  if (trimmedNotes !== (action.notes ?? "")) {
    edit.notes = trimmedNotes ? trimmedNotes : null;
  }
  if (dueDate !== action.dueAtDate) {
    edit.dueAt = dueDate ? dueDate : null;
  }
  if (!sameRecurrence(recurrence, action.recurrence)) {
    edit.recurrence = recurrence;
  }
  if (normalizeLinks(cleanedLinks) !== normalizeLinks(action.links)) {
    edit.links = cleanedLinks;
  }
  if (cleanedHints.join(" ") !== toHintLabels(action.assetHints).join(" ")) {
    edit.assetHints = cleanedHints;
  }
  if (areaId !== action.areaId) {
    edit.areaId = areaId;
  }
  const peopleChanged = !sameIdSet(
    personIds,
    action.linkedPeople.map((p) => p.id),
  );
  const currentReminderChoice = action.reminderSchedule
    ? action.reminderSchedule.kind === "relative"
      ? { kind: "relative" as const, leadMinutes: action.reminderSchedule.leadMinutes ?? 0 }
      : { kind: "exact" as const, localTime: action.reminderSchedule.localTime ?? "09:00" }
    : null;
  const reminderChanged =
    reminderEnabled !== Boolean(action.reminderSchedule) ||
    JSON.stringify(reminderChoice) !== JSON.stringify(currentReminderChoice);
  const hasChange = Object.keys(edit).length > 0 || peopleChanged || reminderChanged;
  // Show the Action's current Area even if it was archived after filing, so the
  // picker displays its label without offering it as a new assignment.
  const editAreas =
    action.areaId && areaName && !areas.some((area) => area.id === action.areaId)
      ? [...areas, { id: action.areaId, name: areaName, archived: true }]
      : areas;

  return (
    <form
      className="flex flex-col gap-3 px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmedTitle || !hasChange) {
          return;
        }
        // Content and people links live behind separate lifecycle mutations; apply
        // content first, then people, and surface whichever ran last so the row
        // reflects both. Either half short-circuits on its own validation message.
        // fallow-ignore-next-line complexity -- Sequential content and people mutations keep partial failures visible.
        submit(async () => {
          let result: GeneralActionMutationResult | null = null;
          if (Object.keys(edit).length > 0) {
            result = await editGeneralActionAction({ generalActionId: action.id, edit });
            if (!result.ok) {
              return result;
            }
          }
          if (peopleChanged) {
            result = await setGeneralActionPeopleAction({
              generalActionId: action.id,
              personIds,
            });
          }
          if (reminderEnabled && dueDate) {
            const clientInstallationId = getReminderInstallationId(window.localStorage);
            const scheduleResult = await saveReminderAction({
              recordKind: recurrence ? "routine" : "general_action",
              recordId: action.id,
              clientInstallationId,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              schedule: reminderChoice,
            });
            if (scheduleResult.nextValidChoice) {
              setReminderChoice({ kind: "relative", leadMinutes: 0 });
              return {
                ok: false,
                error: `That lead time has passed. Save again to use ${scheduleResult.nextValidChoice.label}.`,
              };
            }
            if (scheduleResult.optIn.state === "offer") {
              onReminderOptIn(clientInstallationId);
            }
            const view = result?.ok ? result.view : action;
            result = {
              ok: true,
              view: {
                ...view,
                reminderSchedule: toReminderScheduleView(scheduleResult.schedule),
              },
            };
          } else if (action.reminderSchedule) {
            await clearReminderAction({
              recordKind: action.recurrence ? "routine" : "general_action",
              recordId: action.id,
            });
            const view = result?.ok ? result.view : action;
            result = { ok: true, view: { ...view, reminderSchedule: null } };
          }
          return result ?? { ok: true, view: action };
        });
      }}
    >
      <Input
        aria-label="Action title"
        onChange={(event) => setTitle(event.target.value)}
        value={title}
      />
      <Textarea
        aria-label="Notes"
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        value={notes}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-[length:var(--text-small)] text-muted-foreground">Due date</span>
        <Input
          aria-label="Due date"
          className="w-full sm:w-48"
          onChange={(event) => setDueDate(event.target.value)}
          type="date"
          value={dueDate}
        />
      </div>
      <RecurrenceField
        onChange={(value) => {
          setRecurrence(value);
          if (value && reminderChoice.kind === "exact") {
            setReminderChoice({ kind: "relative", leadMinutes: 0 });
          }
        }}
        value={recurrence}
      />
      {dueDate ? (
        <GeneralActionReminderField
          choice={reminderChoice}
          enabled={reminderEnabled}
          onChoiceChange={setReminderChoice}
          onEnabledChange={setReminderEnabled}
          relativeOnly={Boolean(recurrence)}
        />
      ) : null}
      {editAreas.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[length:var(--text-small)] text-muted-foreground">Area</span>
          <AreaSelect
            areas={editAreas}
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
      <div className="flex items-center justify-end gap-1.5">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={pending || !trimmedTitle || !hasChange} size="sm" type="submit">
          {saving ? <Spinner /> : <CheckIcon />}
          Save
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}

/** Owner-only visibility change, with a moment-of-commit preview when it widens the audience. */
// fallow-ignore-next-line complexity -- The form keeps visibility validation and commit preview in one owner-scoped boundary.
function ActionShareForm({
  action,
  shareableMembers,
  onUpdate,
  onCancel,
}: {
  action: GeneralActionView;
  shareableMembers: ShareableActionMember[];
  onUpdate: (view: GeneralActionView) => void;
  onCancel: () => void;
}) {
  const [visibilityChoice, setVisibilityChoice] = useState<VisibilityChoice>(
    visibilityChoiceForScope(action.scope),
  );
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const { error, saving, pending, submit } = useInPlaceActionUpdate(onUpdate, onCancel);

  const selectedMembersRequired =
    visibilityChoice === "selected_members" && selectedUserIds.length === 0;
  const currentChoice = visibilityChoiceForScope(action.scope);
  const changed = visibilityChoice !== currentChoice;

  return (
    <form
      className="flex flex-col gap-3 px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (selectedMembersRequired) {
          return;
        }
        submit(() =>
          setGeneralActionVisibilityAction({
            generalActionId: action.id,
            visibilityChoice,
            ...(selectedUserIds.length ? { selectedUserIds } : {}),
          }),
        );
      }}
    >
      <ActionVisibilityField
        members={shareableMembers}
        name={`action-visibility-${action.id}`}
        onChoiceChange={setVisibilityChoice}
        onSelectedChange={setSelectedUserIds}
        selectedUserIds={selectedUserIds}
        value={visibilityChoice}
      />
      {visibilityChoice === "selected_members" ? (
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          Anyone you shared this with before is cleared.
        </p>
      ) : null}
      {/* A moment-of-commit preview whenever this differs from the current scope, so
          widening the audience costs a deliberate beat (ADR 0153). */}
      {changed ? (
        <AudiencePreview
          choice={visibilityChoice}
          householdSize={shareableMembers.length + 1}
          selectedCount={selectedUserIds.length}
        />
      ) : null}
      <div className="flex items-center justify-end gap-1.5">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={pending || selectedMembersRequired} size="sm" type="submit">
          {saving ? <Spinner /> : <CheckIcon />}
          Save visibility
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}

/** Set an Action aside until a chosen date (deferral). */
// fallow-ignore-next-line complexity -- The in-place form owns its date, status, and mutation states together.
function ActionDeferForm({
  action,
  onUpdate,
  onCancel,
}: {
  action: GeneralActionView;
  onUpdate: (view: GeneralActionView) => void;
  onCancel: () => void;
}) {
  const [deferDate, setDeferDate] = useState(action.deferUntilDate);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [undoRequested, setUndoRequested] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const undoTimer = useRef<number | null>(null);
  const undoRequestedRef = useRef(false);
  const [pending, startTransition] = useTransition();

  const unchanged = deferDate === action.deferUntilDate && action.status === "deferred";

  useEffect(
    () => () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  function requestUndo() {
    if (saving) {
      undoRequestedRef.current = true;
      setUndoRequested(true);
      return;
    }
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    startTransition(async () => {
      setError(null);
      try {
        const result = await undeferGeneralActionAction({ generalActionId: action.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onUpdate(result.view);
        onCancel();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function submitDefer() {
    if (!deferDate || unchanged) return;
    const deferUntilISO = `${deferDate}T00:00:00.000Z`;
    const optimistic = {
      ...action,
      status: "deferred" as const,
      deferUntilDate: deferDate,
      deferUntilISO,
      surfaceState: "deferred" as const,
      surfaceLabel: `Set aside until ${shortDay(deferUntilISO)}`,
    };
    setError(null);
    setSaving(true);
    setUndoAvailable(true);
    undoRequestedRef.current = false;
    setUndoRequested(false);
    onUpdate(optimistic);
    startTransition(async () => {
      try {
        const result = await deferGeneralActionAction({
          generalActionId: action.id,
          deferUntil: deferDate,
        });
        if (!result.ok) {
          setError(result.error);
          setSaving(false);
          setUndoAvailable(false);
          onUpdate(action);
          return;
        }
        onUpdate(result.view);
        setSaving(false);
        if (undoRequestedRef.current) {
          requestUndo();
          return;
        }
        undoTimer.current = window.setTimeout(onCancel, 5000);
      } catch {
        setError(GENERIC_ERROR);
        setSaving(false);
        setUndoAvailable(false);
        onUpdate(action);
      }
    });
  }

  return (
    <form
      className="flex flex-wrap items-end justify-between gap-2 px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        submitDefer();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[length:var(--text-caption)] text-muted-foreground">
          Set aside until
        </span>
        <Input
          aria-label="Set aside until"
          className="w-44"
          onChange={(event) => setDeferDate(event.target.value)}
          type="date"
          value={deferDate}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={pending || !deferDate || unchanged}
          size="sm"
          type="submit"
          variant="outline"
        >
          {saving ? <Spinner /> : <MoonIcon />}
          Set aside
        </Button>
        {undoAvailable ? (
          <Button
            disabled={pending && !saving}
            onClick={requestUndo}
            size="sm"
            type="button"
            variant="outline"
          >
            {pending && !saving ? <Spinner /> : null}
            {undoRequested ? "Undoing…" : "Undo set aside"}
          </Button>
        ) : null}
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}

/** The overflow menu: set aside, pause (Routines), owner-only edit/visibility, history, dismiss, archive. */
function ActionOverflowMenu({
  action,
  shareableMembers,
  pending,
  busyKey,
  onSetAside,
  onPause,
  onSkip,
  onEdit,
  onShare,
  onHistory,
  onDismiss,
  onArchive,
}: {
  action: GeneralActionView;
  shareableMembers: ShareableActionMember[];
  pending: boolean;
  busyKey: string | null;
  onSetAside: () => void;
  onPause: () => void;
  onSkip: () => void;
  onEdit: () => void;
  onShare: () => void;
  onHistory: () => void;
  onDismiss: () => void;
  onArchive: () => void;
}) {
  const mobileItemClassName = "max-sm:min-h-11";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="More actions"
          className="max-sm:min-h-11 max-sm:min-w-11"
          disabled={pending}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {busyKey === "dismiss" || busyKey === "archive" || busyKey === "pause" ? (
            <Spinner />
          ) : (
            <MoreHorizontalIcon />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className={mobileItemClassName} onSelect={onSetAside}>
          <ClockIcon />
          Set aside
        </DropdownMenuItem>
        {/* Pausing suspends a Routine's recurrence until resumed — a one-time
            Action has nothing to pause, so this only shows for Routines (ADR 0148). */}
        {action.isRoutine ? (
          <>
            <DropdownMenuItem className={mobileItemClassName} onSelect={onSkip}>
              <SkipForwardIcon />
              Skip this occurrence
            </DropdownMenuItem>
            <DropdownMenuItem className={mobileItemClassName} onSelect={onPause}>
              <PauseIcon />
              Pause routine
            </DropdownMenuItem>
          </>
        ) : null}
        {/* Content, people, and visibility belong to the owner; a viewing member
            can still act on the Action above, but not re-author it (ADR 0153). */}
        {action.owned ? (
          <DropdownMenuItem className={mobileItemClassName} onSelect={onEdit}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
        ) : null}
        {action.owned && shareableMembers.length ? (
          <DropdownMenuItem className={mobileItemClassName} onSelect={onShare}>
            <UsersIcon />
            Visibility
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className={mobileItemClassName} onSelect={onHistory}>
          <HistoryIcon />
          History
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={mobileItemClassName} onSelect={onDismiss}>
          <XIcon />
          Dismiss
        </DropdownMenuItem>
        <DropdownMenuItem className={mobileItemClassName} onSelect={onArchive}>
          <ArchiveIcon />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * An active (open or deferred) Action row with inline view / edit / defer / share
 * modes. Every mutation flows through the shared lifecycle server actions; completing,
 * dismissing, or archiving animates the row out before the parent drops it. Whoever
 * can see the Action can act on it (complete, set aside, dismiss, archive) so a
 * household member can help move a shared Action along, but only the owner may edit
 * its content, links, people, asset hints, or visibility (ADR 0153). Actions sit at
 * the bottom-right of the row where a thumb reaches, and the row stacks cleanly on
 * narrow screens (ADR 0161 mobile-usable).
 *
 * The edit/defer/share modes and the overflow menu are extracted into their own components
 * above; what remains here is the view-mode composition. Its cognitive score reflects that
 * JSX composition depth and the small mode/lifecycle hook set, not branching logic
 * (cyclomatic is within threshold) — further splintering the calm row markup would hurt
 * readability more than it helps, so this presentational shell is annotated (ADR 0161).
 */
// fallow-ignore-next-line complexity
export function ActionRow({
  action,
  areas,
  areaName = null,
  people = [],
  shareableMembers = [],
  onResolve,
  onUpdate,
  secondaryUndo,
}: {
  action: GeneralActionView;
  /** Active Areas the Action can be re-filed under. */
  areas: GeneralActionAreaView[];
  /** The Action's current Area name (archived included), for the view-mode label. */
  areaName?: string | null;
  /** The owner's people, for linking as context (ADR 0155). Owner-only editing. */
  people?: ActionPersonOption[];
  /** Household members the Action can be shared with; empty hides the share control. */
  shareableMembers?: ShareableActionMember[];
  onResolve: (view: GeneralActionView) => void;
  onUpdate: (view: GeneralActionView) => void;
  secondaryUndo?: {
    error?: string;
    label: string;
    requested: boolean;
    originalPending: boolean;
    onUndo?: () => void;
  };
}) {
  const [mode, setMode] = useState<"view" | "edit" | "defer" | "share">("view");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A brief, self-clearing confirmation after a Routine occurrence rolls forward, so
  // the in-place update isn't silent — the user sees when it comes back.
  const [notice, setNotice] = useState<string | null>(null);
  // Which control initiated the in-flight mutation, so the spinner lands on the
  // button the user pressed rather than the whole row.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [optInInstallationId, setOptInInstallationId] = useState<string | null>(null);
  const [undo, setUndo] = useState<null | {
    label: string;
    run: () => Promise<GeneralActionMutationResult>;
    requested: boolean;
  }>(null);
  const resolveTimer = useRef<number | null>(null);
  const undoRequestedRef = useRef(false);
  const initiatingControlRef = useRef<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(
    () => () => {
      if (resolveTimer.current !== null) window.clearTimeout(resolveTimer.current);
    },
    [],
  );

  const returnToView = () => setMode("view");

  function restoreInitiatingFocus() {
    requestAnimationFrame(() => initiatingControlRef.current?.focus());
  }

  function reconcileResolvedView(view: GeneralActionView) {
    const row = document.getElementById(`action-${action.id}`);
    const fallback = row?.nextElementSibling ?? row?.previousElementSibling;
    onResolve(view);
    requestAnimationFrame(() => {
      const focusTarget = fallback?.querySelector<HTMLElement>("button, [tabindex]");
      if (focusTarget) {
        focusTarget.focus();
        return;
      }
      const heading = row?.closest("main")?.querySelector<HTMLElement>("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    });
  }

  // Resolving mutations (complete/dismiss/archive) animate the row out on success;
  // a validation failure surfaces the message and leaves the row in place.
  function leaveThen(
    key: string,
    run: () => Promise<GeneralActionMutationResult>,
    inverse?: { label: string; run: () => Promise<GeneralActionMutationResult> },
  ) {
    setError(null);
    setNotice(null);
    setBusyKey(key);
    initiatingControlRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // These lifecycle changes have a deterministic inverse. Acknowledge the
    // intent immediately, then restore this exact row if the server rejects it.
    setLeaving(true);
    if (inverse) {
      undoRequestedRef.current = false;
      setUndo({ ...inverse, requested: false });
    }
    startTransition(async () => {
      try {
        const result = await run();
        if (!result.ok) {
          setError(result.error);
          setBusyKey(null);
          setLeaving(false);
          setUndo(null);
          undoRequestedRef.current = false;
          restoreInitiatingFocus();
          return;
        }
        if (inverse) {
          setLeaving(false);
          setBusyKey(null);
          if (undoRequestedRef.current) {
            runUndo(inverse);
            return;
          }
          setNotice(
            `${
              key === "complete"
                ? "Completed"
                : key === "pause"
                  ? "Paused"
                  : key === "dismiss"
                    ? "Dismissed"
                    : "Archived"
            }. Undo available.`,
          );
          resolveTimer.current = window.setTimeout(() => reconcileResolvedView(result.view), 5000);
          return;
        }
        window.setTimeout(() => reconcileResolvedView(result.view), 200);
      } catch {
        setError(GENERIC_ERROR);
        setBusyKey(null);
        setLeaving(false);
        setUndo(null);
        undoRequestedRef.current = false;
        restoreInitiatingFocus();
      }
    });
  }

  function runUndo(override?: { label: string; run: () => Promise<GeneralActionMutationResult> }) {
    const inverse = override ?? undo;
    if (!inverse) return;
    if (busyKey && busyKey !== "undo") {
      undoRequestedRef.current = true;
      setUndo({ ...inverse, requested: true });
      return;
    }
    if (resolveTimer.current !== null) window.clearTimeout(resolveTimer.current);
    setUndo(null);
    setBusyKey("undo");
    startTransition(async () => {
      try {
        const result = await inverse.run();
        if (!result.ok) {
          setError(result.error);
          setBusyKey(null);
          return;
        }
        onUpdate(result.view);
        setNotice("Action restored");
        setBusyKey(null);
      } catch {
        setError(GENERIC_ERROR);
        setBusyKey(null);
      }
    });
  }

  // Completing a Routine occurrence isn't terminal: it rolls forward and stays on the
  // list, so update in place (with a self-clearing confirmation) rather than animating out.
  function advanceRoutineInPlace(kind: "complete" | "skip") {
    setError(null);
    setNotice(null);
    setBusyKey(kind);
    const prior = action;
    const priorDueAtISO = prior.dueAtISO;
    let expectedDueAtISO: string | null = null;
    const inverse = priorDueAtISO
      ? {
          label: kind === "complete" ? "Complete" : "Skip",
          run: () =>
            expectedDueAtISO
              ? undoRoutineOccurrenceAction({
                  expectedDueAt: expectedDueAtISO,
                  generalActionId: prior.id,
                  restoreDueAt: priorDueAtISO,
                })
              : Promise.resolve({ ok: false as const, error: "The Routine is still updating." }),
        }
      : undefined;
    if (inverse) {
      undoRequestedRef.current = false;
      setUndo({ ...inverse, requested: false });
    }
    const nextDueAt = action.recurrence
      ? nextRoutineDueAt(action.recurrence, new Date(action.dueAtISO ?? Date.now()))
      : null;
    if (nextDueAt) {
      const nextISO = nextDueAt.toISOString();
      onUpdate({
        ...action,
        dueAtISO: nextISO,
        dueAtDate: nextISO.slice(0, 10),
        surfaceLabel: `Due ${shortDay(nextISO)}`,
      });
    }
    startTransition(async () => {
      try {
        const result = await (kind === "complete"
          ? completeGeneralActionAction({ generalActionId: action.id })
          : skipGeneralActionOccurrenceAction({ generalActionId: action.id }));
        if (!result.ok) {
          setError(result.error);
          setBusyKey(null);
          onUpdate(prior);
          setUndo(null);
          undoRequestedRef.current = false;
          return;
        }
        expectedDueAtISO = result.view.dueAtISO;
        onUpdate(result.view);
        setBusyKey(null);
        if (inverse && undoRequestedRef.current) {
          runUndo(inverse);
          return;
        }
        if (result.view.dueAtISO) {
          setNotice(
            `${kind === "complete" ? "Done" : "Skipped"} · next ${shortDay(result.view.dueAtISO)}`,
          );
          resolveTimer.current = window.setTimeout(() => {
            setNotice(null);
            setUndo(null);
          }, 5000);
        }
      } catch {
        setError(GENERIC_ERROR);
        setBusyKey(null);
        onUpdate(prior);
        setUndo(null);
        undoRequestedRef.current = false;
      }
    });
  }

  if (mode === "edit") {
    return (
      <ActionEditForm
        action={action}
        areaName={areaName}
        areas={areas}
        onCancel={returnToView}
        onReminderOptIn={setOptInInstallationId}
        onUpdate={onUpdate}
        people={people}
      />
    );
  }

  if (mode === "share") {
    return (
      <ActionShareForm
        action={action}
        onCancel={returnToView}
        onUpdate={onUpdate}
        shareableMembers={shareableMembers}
      />
    );
  }

  if (mode === "defer") {
    return <ActionDeferForm action={action} onCancel={returnToView} onUpdate={onUpdate} />;
  }

  const hasContext =
    action.isRoutine ||
    action.scope !== "private" ||
    action.linkedPeople.length > 0 ||
    action.assetHints.length > 0 ||
    action.linkedAssets.length > 0;
  // On a row the viewer doesn't own, name who shared it so the absent Edit/Visibility
  // controls read as "not yours to re-author", not a missing feature (ADR 0153).
  const ownerName = action.owned
    ? null
    : (shareableMembers.find((member) => member.userId === action.ownerUserId)?.name ?? null);

  return (
    <article
      aria-busy={pending || secondaryUndo?.originalPending}
      className={`flex scroll-mt-24 flex-col gap-2 px-4 py-3.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) motion-reduce:transition-none ${leaving && !undo ? "translate-y-0.5 opacity-0" : ""}`}
      data-leaving={leaving}
      // Deep-link target for the Action Today surface: `/actions#action-<id>` scrolls
      // to and briefly highlights this row (see useDeepLinkHighlight). tabIndex lets the
      // highlight move focus here so the jump is announced to assistive tech.
      id={`action-${action.id}`}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <p className="max-w-[60ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
            {action.title}
          </p>
          {action.notes ? (
            <p className="max-w-[60ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              {action.notes}
            </p>
          ) : null}
          <ActionLinks links={action.links} />
          {hasContext ? <ActionContextStrip action={action} onUpdate={onUpdate} /> : null}
          {ownerName || !action.owned ? (
            <span className="text-[length:var(--text-caption)] text-muted-foreground">
              Shared by {ownerName ?? "a household member"}
            </span>
          ) : null}
          {areaName ? (
            <span className="inline-flex w-fit items-center rounded-full bg-secondary px-2 py-0.5 text-[length:var(--text-caption)] text-secondary-foreground">
              {areaName}
            </span>
          ) : null}
          {action.reminderSchedule ? (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[length:var(--text-caption)] text-primary">
              <BellIcon className="size-3" />
              {action.reminderSchedule.label}
            </span>
          ) : null}
        </div>
        <div className="shrink-0 pt-0.5">
          <ActionDueChip surfaceLabel={action.surfaceLabel} surfaceState={action.surfaceState} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        {undo ? (
          <Button
            disabled={busyKey === "undo"}
            onClick={() => runUndo()}
            size="sm"
            type="button"
            variant="outline"
          >
            {busyKey === "undo" ? <Spinner /> : null}
            {undo.requested ? "Undoing…" : `Undo ${undo.label}`}
          </Button>
        ) : null}
        {!undo && secondaryUndo ? (
          <Button
            disabled={secondaryUndo.requested}
            onClick={secondaryUndo.onUndo}
            size="sm"
            type="button"
            variant="outline"
          >
            {secondaryUndo.requested ? <Spinner /> : null}
            {secondaryUndo.requested ? "Undoing…" : `Undo ${secondaryUndo.label}`}
          </Button>
        ) : null}
        <Button
          className="max-sm:min-h-11"
          disabled={pending || undo !== null || secondaryUndo !== undefined}
          onClick={() => {
            if (action.isRoutine) {
              advanceRoutineInPlace("complete");
            } else {
              leaveThen(
                "complete",
                () => completeGeneralActionAction({ generalActionId: action.id }),
                {
                  label: "Complete",
                  run: () => reopenGeneralActionAction({ generalActionId: action.id }),
                },
              );
            }
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {busyKey === "complete" ? <Spinner /> : <CheckIcon />}
          {action.isRoutine ? "Done for now" : "Complete"}
        </Button>
        <ActionOverflowMenu
          action={action}
          busyKey={busyKey}
          onArchive={() =>
            leaveThen("archive", () => archiveGeneralActionAction({ generalActionId: action.id }), {
              label: "Archive",
              run: () => restoreGeneralActionAction({ generalActionId: action.id }),
            })
          }
          onDismiss={() =>
            leaveThen("dismiss", () => dismissGeneralActionAction({ generalActionId: action.id }), {
              label: "Dismiss",
              run: () => reopenGeneralActionAction({ generalActionId: action.id }),
            })
          }
          onEdit={() => {
            setError(null);
            setMode("edit");
          }}
          onHistory={() => setHistoryOpen(true)}
          onPause={() =>
            leaveThen("pause", () => pauseGeneralActionAction({ generalActionId: action.id }), {
              label: "Pause",
              run: () => resumeGeneralActionAction({ generalActionId: action.id }),
            })
          }
          onSkip={() => advanceRoutineInPlace("skip")}
          onSetAside={() => {
            setError(null);
            setMode("defer");
          }}
          onShare={() => {
            setError(null);
            setMode("share");
          }}
          pending={pending}
          shareableMembers={shareableMembers}
        />
      </div>
      {pending ? (
        <p aria-live="polite" className="text-[length:var(--text-caption)] text-muted-foreground">
          Updating action…
        </p>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
      {secondaryUndo?.error ? <ErrorText message={secondaryUndo.error} /> : null}
      {notice ? (
        <p
          className="inline-flex items-center gap-1.5 self-end text-[length:var(--text-caption)] text-muted-foreground"
          role="status"
        >
          <CheckIcon aria-hidden className="size-3 text-primary" />
          {notice}
        </p>
      ) : null}
      {optInInstallationId ? (
        <ReminderOptInInvitation
          clientInstallationId={optInInstallationId}
          onDismiss={() => setOptInInstallationId(null)}
        />
      ) : null}
      <ActionHistoryDialog
        generalActionId={action.id}
        onOpenChange={setHistoryOpen}
        open={historyOpen}
        title={action.title}
      />
    </article>
  );
}
