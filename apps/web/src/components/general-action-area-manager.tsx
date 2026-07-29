"use client";

import { useState, useTransition } from "react";
import {
  archiveGeneralActionAreaAction,
  createGeneralActionAreaAction,
  renameGeneralActionAreaAction,
  unarchiveGeneralActionAreaAction,
} from "@/app/actions/general-action-areas";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type {
  GeneralActionAreaMutationResult,
  GeneralActionAreaView,
} from "@/lib/general-action-area-view";

/**
 * Quiet management for flat Areas, reached from a low-emphasis "Manage areas" link
 * rather than sitting on the calm surface. Create a new Area, rename one inline,
 * archive one behind a two-step confirm so a mis-click never quietly retires a
 * category, and restore an archived one from the collapsed "Archived" section so
 * archive is genuinely non-destructive. Archiving removes an Area from the filter
 * and picker; any Actions filed under it keep it (archive is not delete; ADR 0146).
 * Every mutation flows through the shared owner-scoped Area lifecycle via server
 * actions.
 */
// The per-area row is extracted into ActiveAreaRow; what remains is the dialog shell (create
// form, active list, collapsed archived section). Its cognitive score is dialog JSX depth
// plus the area-mutation hook set, not branching logic (cyclomatic is trivial).
// fallow-ignore-next-line complexity
export function AreaManagerDialog({
  open,
  onOpenChange,
  activeAreas,
  archivedAreas,
  onCreated,
  onRenamed,
  onArchived,
  onUnarchived,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeAreas: GeneralActionAreaView[];
  archivedAreas: GeneralActionAreaView[];
  onCreated: (view: GeneralActionAreaView) => void;
  onRenamed: (view: GeneralActionAreaView) => void;
  onArchived: (id: string) => void;
  onUnarchived: (view: GeneralActionAreaView) => void;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    key: string,
    action: () => Promise<GeneralActionAreaMutationResult>,
    onOk: (view: GeneralActionAreaView) => void,
  ) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          setBusyKey(null);
          return;
        }
        onOk(result.view);
        setBusyKey(null);
      } catch {
        setError(GENERIC_ERROR);
        setBusyKey(null);
      }
    });
  }

  function createArea() {
    const name = newName.trim();
    if (!name) {
      return;
    }
    run(
      "create",
      () => createGeneralActionAreaAction({ name }),
      (view) => {
        onCreated(view);
        setNewName("");
      },
    );
  }

  function startRename(area: GeneralActionAreaView) {
    setConfirmingId(null);
    setError(null);
    setEditingId(area.id);
    setEditingName(area.name);
  }

  function saveRename(areaId: string) {
    const name = editingName.trim();
    if (!name) {
      return;
    }
    run(
      `rename-${areaId}`,
      () => renameGeneralActionAreaAction({ areaId, name }),
      (view) => {
        onRenamed(view);
        setEditingId(null);
      },
    );
  }

  function archiveArea(areaId: string) {
    run(
      `archive-${areaId}`,
      () => archiveGeneralActionAreaAction({ areaId }),
      () => {
        onArchived(areaId);
        setConfirmingId(null);
      },
    );
  }

  function unarchiveArea(areaId: string) {
    run(`unarchive-${areaId}`, () => unarchiveGeneralActionAreaAction({ areaId }), onUnarchived);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Areas</DialogTitle>
          <DialogDescription>
            Broad categories for your actions, like Home or Finance. Archiving an area keeps the
            actions filed under it.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            createArea();
          }}
        >
          <Input
            aria-label="New area name"
            className="flex-1"
            maxLength={60}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Add an area"
            value={newName}
          />
          <Button disabled={pending || !newName.trim()} size="sm" type="submit">
            {busyKey === "create" ? <Spinner /> : <PlusIcon />}
            Add
          </Button>
        </form>

        {activeAreas.length ? (
          <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-surface">
            {activeAreas.map((area) => (
              <ActiveAreaRow
                area={area}
                busyKey={busyKey}
                editing={editingId === area.id}
                editingName={editingName}
                key={area.id}
                onBeginArchive={() => {
                  setError(null);
                  setEditingId(null);
                  setConfirmingId(area.id);
                }}
                onArchive={() => archiveArea(area.id)}
                onCancelArchive={() => setConfirmingId(null)}
                onCancelRename={() => setEditingId(null)}
                onEditingNameChange={setEditingName}
                onSaveRename={() => saveRename(area.id)}
                onStartRename={() => startRename(area)}
                pending={pending}
                confirming={confirmingId === area.id}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            description="Areas group related actions, like Home or Finance. Add one above."
            size="compact"
            title="No areas yet."
          />
        )}

        {archivedAreas.length ? (
          // The same disclosure vocabulary as the Actions surface's shelf: a real chevron
          // affordance and a 44px row, rather than a marker-less summary that reads as a
          // caption nobody thinks to click.
          <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger className="group -mx-1.5 flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1.5 text-left text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <ChevronDownIcon
                aria-hidden
                className="size-3.5 shrink-0 transition-transform duration-150 ease-(--motion-ease-out) group-data-[state=open]:rotate-180"
              />
              Archived
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-surface">
                {archivedAreas.map((area) => (
                  <li className="flex items-center gap-2 px-3 py-2" key={area.id}>
                    <span className="flex-1 truncate text-[length:var(--text-small)] text-muted-foreground">
                      {area.name}
                    </span>
                    <Button
                      disabled={pending}
                      onClick={() => unarchiveArea(area.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {busyKey === `unarchive-${area.id}` ? <Spinner /> : <RotateCcwIcon />}
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {error ? <ErrorText message={error} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * One active Area row: its name with inline rename, and a two-step archive confirm. The
 * three visual states (renaming, archive-confirm, resting) live here so the dialog stays a
 * flat list rather than a triply-nested map body.
 */
// A pure presentational row (no hooks, cyclomatic 6) rendering its three visual states
// (renaming, archive-confirm, resting). Its cognitive score is those states' JSX depth;
// splitting each state into its own component would fragment one row without reducing
// genuine complexity.
// fallow-ignore-next-line complexity
function ActiveAreaRow({
  area,
  editing,
  confirming,
  editingName,
  pending,
  busyKey,
  onEditingNameChange,
  onSaveRename,
  onCancelRename,
  onStartRename,
  onBeginArchive,
  onArchive,
  onCancelArchive,
}: {
  area: GeneralActionAreaView;
  editing: boolean;
  confirming: boolean;
  editingName: string;
  pending: boolean;
  busyKey: string | null;
  onEditingNameChange: (name: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onBeginArchive: () => void;
  onArchive: () => void;
  onCancelArchive: () => void;
}) {
  if (editing) {
    return (
      <li className="flex items-center gap-2 px-3 py-2">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveRename();
          }}
        >
          <Input
            aria-label={`Rename ${area.name}`}
            autoFocus
            className="h-8 flex-1"
            maxLength={60}
            onChange={(event) => onEditingNameChange(event.target.value)}
            value={editingName}
          />
          <Button
            aria-label="Save name"
            disabled={pending || !editingName.trim()}
            size="icon-sm"
            type="submit"
            variant="ghost"
          >
            {busyKey === `rename-${area.id}` ? <Spinner /> : <CheckIcon />}
          </Button>
          <Button
            aria-label="Cancel rename"
            onClick={onCancelRename}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <span className="flex-1 truncate text-[length:var(--text-body)]">{area.name}</span>
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[length:var(--text-caption)] text-muted-foreground">Archive?</span>
          <Button disabled={pending} onClick={onArchive} size="sm" type="button" variant="outline">
            {busyKey === `archive-${area.id}` ? <Spinner /> : null}
            Archive
          </Button>
          <Button onClick={onCancelArchive} size="sm" type="button" variant="ghost">
            Keep
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          <Button
            aria-label={`Rename ${area.name}`}
            disabled={pending}
            onClick={onStartRename}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PencilIcon />
          </Button>
          <Button
            aria-label={`Archive ${area.name}`}
            disabled={pending}
            onClick={onBeginArchive}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ArchiveIcon />
          </Button>
        </div>
      )}
    </li>
  );
}
