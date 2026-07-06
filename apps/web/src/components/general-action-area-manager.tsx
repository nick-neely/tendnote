"use client";

import { ArchiveIcon, CheckIcon, PencilIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useState, useTransition } from "react";
import {
  archiveGeneralActionAreaAction,
  createGeneralActionAreaAction,
  renameGeneralActionAreaAction,
  unarchiveGeneralActionAreaAction,
} from "@/app/actions/general-action-areas";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
            Broad categories for your actions — like Home or Finance. Rename or archive any, or add
            your own.
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
            {activeAreas.map((area) => {
              const editing = editingId === area.id;
              const confirming = confirmingId === area.id;

              return (
                <li className="flex items-center gap-2 px-3 py-2" key={area.id}>
                  {editing ? (
                    <form
                      className="flex flex-1 items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveRename(area.id);
                      }}
                    >
                      <Input
                        aria-label={`Rename ${area.name}`}
                        autoFocus
                        className="h-8 flex-1"
                        maxLength={60}
                        onChange={(event) => setEditingName(event.target.value)}
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
                        onClick={() => setEditingId(null)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <XIcon />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-[length:var(--text-body)]">
                        {area.name}
                      </span>
                      {confirming ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[length:var(--text-caption)] text-muted-foreground">
                            Archive?
                          </span>
                          <Button
                            disabled={pending}
                            onClick={() => archiveArea(area.id)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {busyKey === `archive-${area.id}` ? <Spinner /> : null}
                            Archive
                          </Button>
                          <Button
                            onClick={() => setConfirmingId(null)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Keep
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5">
                          <Button
                            aria-label={`Rename ${area.name}`}
                            disabled={pending}
                            onClick={() => startRename(area)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            aria-label={`Archive ${area.name}`}
                            disabled={pending}
                            onClick={() => {
                              setError(null);
                              setEditingId(null);
                              setConfirmingId(area.id);
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <ArchiveIcon />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-5 text-[length:var(--text-small)] text-muted-foreground">
            No areas yet. Add one above to start grouping your actions.
          </p>
        )}

        {archivedAreas.length ? (
          <details className="group">
            <summary className="cursor-pointer list-none text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground">
              Archived
            </summary>
            <ul className="mt-2 flex flex-col divide-y overflow-hidden rounded-xl border bg-surface">
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
          </details>
        ) : null}

        {error ? <ErrorText message={error} /> : null}
      </DialogContent>
    </Dialog>
  );
}
