"use client";

import type { GeneralActionLink } from "@tendnote/domain";
import { type VisibilityChoice, visibilityChoiceForScope } from "@tendnote/domain/privacy";
import {
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  HistoryIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PencilIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useState, useTransition } from "react";
import {
  archiveGeneralActionAction,
  completeGeneralActionAction,
  deferGeneralActionAction,
  dismissGeneralActionAction,
  editGeneralActionAction,
  setGeneralActionPeopleAction,
  setGeneralActionVisibilityAction,
} from "@/app/actions/general-actions";
import { AreaSelect } from "@/components/general-action-area-select";
import {
  ActionAssetHintsField,
  cleanHintLabels,
  toHintLabels,
} from "@/components/general-action-asset-hints-field";
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
import {
  ActionContextChip,
  ActionDueChip,
  ActionScopeChip,
  ErrorText,
  GENERIC_ERROR,
} from "@/components/general-action-shared";
import {
  ActionVisibilityField,
  AudiencePreview,
  type ShareableActionMember,
} from "@/components/general-action-visibility-field";
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

/**
 * An active (open or deferred) Action row with inline view / edit / defer / share
 * modes. Every mutation flows through the shared lifecycle server actions; completing,
 * dismissing, or archiving animates the row out before the parent drops it. Whoever
 * can see the Action can act on it (complete, set aside, dismiss, archive) so a
 * household member can help move a shared Action along, but only the owner may edit
 * its content, links, people, asset hints, or visibility (ADR 0153). Actions sit at
 * the bottom-right of the row where a thumb reaches, and the row stacks cleanly on
 * narrow screens (ADR 0161 mobile-usable).
 */
export function ActionRow({
  action,
  areas,
  areaName = null,
  people = [],
  shareableMembers = [],
  onResolve,
  onUpdate,
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
  onResolve: (id: string) => void;
  onUpdate: (view: GeneralActionView) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "defer" | "share">("view");
  const [title, setTitle] = useState(action.title);
  const [notes, setNotes] = useState(action.notes ?? "");
  const [dueDate, setDueDate] = useState(action.dueAtDate);
  const [links, setLinks] = useState<LinkDraft[]>(toLinkDrafts(action.links));
  const [hintLabels, setHintLabels] = useState<string[]>(toHintLabels(action.assetHints));
  const [personIds, setPersonIds] = useState<string[]>(action.linkedPeople.map((p) => p.id));
  const [areaId, setAreaId] = useState<string | null>(action.areaId);
  const [deferDate, setDeferDate] = useState(action.deferUntilDate);
  const [visibilityChoice, setVisibilityChoice] = useState<VisibilityChoice>(
    visibilityChoiceForScope(action.scope),
  );
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which control initiated the in-flight mutation, so the spinner lands on the
  // button the user pressed rather than the whole row.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Resolving mutations (complete/dismiss/archive) animate the row out on success;
  // a validation failure surfaces the message and leaves the row in place.
  function leaveThen(key: string, run: () => Promise<GeneralActionMutationResult>) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      try {
        const result = await run();
        if (!result.ok) {
          setError(result.error);
          setBusyKey(null);
          return;
        }
        setLeaving(true);
        window.setTimeout(() => onResolve(action.id), 200);
      } catch {
        setError(GENERIC_ERROR);
        setBusyKey(null);
      }
    });
  }

  // In-place updates (edit/defer/share) hand the updated view back and return to view
  // mode on success; a validation failure keeps the form open with the message.
  function runUpdate(key: string, run: () => Promise<GeneralActionMutationResult>) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      try {
        const result = await run();
        if (!result.ok) {
          setError(result.error);
          setBusyKey(null);
          return;
        }
        onUpdate(result.view);
        setMode("view");
        setBusyKey(null);
      } catch {
        setError(GENERIC_ERROR);
        setBusyKey(null);
      }
    });
  }

  function startEditing() {
    setTitle(action.title);
    setNotes(action.notes ?? "");
    setDueDate(action.dueAtDate);
    setLinks(toLinkDrafts(action.links));
    setHintLabels(toHintLabels(action.assetHints));
    setPersonIds(action.linkedPeople.map((p) => p.id));
    setAreaId(action.areaId);
    setError(null);
    setMode("edit");
  }

  function startDeferring() {
    setDeferDate(action.deferUntilDate);
    setError(null);
    setMode("defer");
  }

  function startSharing() {
    setVisibilityChoice(visibilityChoiceForScope(action.scope));
    setSelectedUserIds([]);
    setError(null);
    setMode("share");
  }

  function cancelEditing() {
    setMode("view");
    setError(null);
  }

  if (mode === "edit") {
    const trimmedTitle = title.trim();
    const trimmedNotes = notes.trim();
    const cleanedLinks = cleanLinks(links);
    const cleanedHints = cleanHintLabels(hintLabels);
    const edit: {
      title?: string;
      notes?: string | null;
      dueAt?: string | null;
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
    if (normalizeLinks(cleanedLinks) !== normalizeLinks(action.links)) {
      edit.links = cleanedLinks;
    }
    if (cleanedHints.join(" ") !== toHintLabels(action.assetHints).join(" ")) {
      edit.assetHints = cleanedHints;
    }
    if (areaId !== action.areaId) {
      edit.areaId = areaId;
    }
    const peopleChanged = !sameIdSet(
      personIds,
      action.linkedPeople.map((p) => p.id),
    );
    const hasChange = Object.keys(edit).length > 0 || peopleChanged;
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
          runUpdate("edit", async () => {
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
          <Button onClick={cancelEditing} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending || !trimmedTitle || !hasChange} size="sm" type="submit">
            {busyKey === "edit" ? <Spinner /> : <CheckIcon />}
            Save
          </Button>
        </div>
        {error ? <ErrorText message={error} /> : null}
      </form>
    );
  }

  if (mode === "share") {
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
          runUpdate("share", () =>
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
            Choose who can see this again — anyone shared with before is cleared.
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
          <Button onClick={cancelEditing} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending || selectedMembersRequired} size="sm" type="submit">
            {busyKey === "share" ? <Spinner /> : <CheckIcon />}
            Save visibility
          </Button>
        </div>
        {error ? <ErrorText message={error} /> : null}
      </form>
    );
  }

  if (mode === "defer") {
    const unchanged = deferDate === action.deferUntilDate && action.status === "deferred";

    return (
      <form
        className="flex flex-wrap items-end justify-between gap-2 px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!deferDate || unchanged) {
            return;
          }
          runUpdate("defer", () =>
            deferGeneralActionAction({ generalActionId: action.id, deferUntil: deferDate }),
          );
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
          <Button onClick={cancelEditing} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={pending || !deferDate || unchanged}
            size="sm"
            type="submit"
            variant="outline"
          >
            {busyKey === "defer" ? <Spinner /> : <MoonIcon />}
            Set aside
          </Button>
        </div>
        {error ? <ErrorText message={error} /> : null}
      </form>
    );
  }

  const hasContext =
    action.scope !== "private" || action.linkedPeople.length > 0 || action.assetHints.length > 0;
  // On a row the viewer doesn't own, name who shared it so the absent Edit/Visibility
  // controls read as "not yours to re-author", not a missing feature (ADR 0153).
  const ownerName = action.owned
    ? null
    : (shareableMembers.find((member) => member.userId === action.ownerUserId)?.name ?? null);

  return (
    <article
      className="flex flex-col gap-2 px-4 py-3.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
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
          {hasContext ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <ActionScopeChip label={action.visibilityLabel} scope={action.scope} />
              {action.linkedPeople.map((person) => (
                <ActionContextChip key={person.id} kind="person">
                  {person.displayName}
                </ActionContextChip>
              ))}
              {action.assetHints.map((hint) => (
                <ActionContextChip key={hint.label} kind="asset">
                  {hint.label}
                </ActionContextChip>
              ))}
            </div>
          ) : null}
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
        </div>
        <div className="shrink-0 pt-0.5">
          <ActionDueChip surfaceLabel={action.surfaceLabel} surfaceState={action.surfaceState} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          disabled={pending}
          onClick={() =>
            leaveThen("complete", () => completeGeneralActionAction({ generalActionId: action.id }))
          }
          size="sm"
          type="button"
          variant="outline"
        >
          {busyKey === "complete" ? <Spinner /> : <CheckIcon />}
          Complete
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="More actions"
              disabled={pending}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {busyKey === "dismiss" || busyKey === "archive" ? (
                <Spinner />
              ) : (
                <MoreHorizontalIcon />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={startDeferring}>
              <ClockIcon />
              Set aside
            </DropdownMenuItem>
            {/* Content, people, and visibility belong to the owner; a viewing member
                can still act on the Action above, but not re-author it (ADR 0153). */}
            {action.owned ? (
              <DropdownMenuItem onSelect={startEditing}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
            ) : null}
            {action.owned && shareableMembers.length ? (
              <DropdownMenuItem onSelect={startSharing}>
                <UsersIcon />
                Visibility
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
              <HistoryIcon />
              History
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                leaveThen("dismiss", () =>
                  dismissGeneralActionAction({ generalActionId: action.id }),
                )
              }
            >
              <XIcon />
              Dismiss
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                leaveThen("archive", () =>
                  archiveGeneralActionAction({ generalActionId: action.id }),
                )
              }
            >
              <ArchiveIcon />
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error ? <ErrorText message={error} /> : null}
      <ActionHistoryDialog
        generalActionId={action.id}
        onOpenChange={setHistoryOpen}
        open={historyOpen}
        title={action.title}
      />
    </article>
  );
}
