"use client";

import type { GeneralActionLink } from "@tendnote/domain";
import {
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  HistoryIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import { useState, useTransition } from "react";
import {
  archiveGeneralActionAction,
  completeGeneralActionAction,
  deferGeneralActionAction,
  dismissGeneralActionAction,
  editGeneralActionAction,
} from "@/app/actions/general-actions";
import { ActionHistoryDialog } from "@/components/general-action-history-dialog";
import {
  ActionLinksField,
  cleanLinks,
  type LinkDraft,
  toLinkDrafts,
} from "@/components/general-action-links-field";
import { ActionDueChip, ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
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

/**
 * An active (open or deferred) Action row with inline view / edit / defer modes.
 * Every mutation flows through the shared owner-scoped lifecycle server actions;
 * completing, dismissing, or archiving animates the row out before the parent
 * drops it. Actions sit at the bottom-right of the row where a thumb reaches, and
 * the row stacks cleanly on narrow screens (ADR 0161 mobile-usable).
 */
export function ActionRow({
  action,
  onResolve,
  onUpdate,
}: {
  action: GeneralActionView;
  onResolve: (id: string) => void;
  onUpdate: (view: GeneralActionView) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "defer">("view");
  const [title, setTitle] = useState(action.title);
  const [notes, setNotes] = useState(action.notes ?? "");
  const [dueDate, setDueDate] = useState(action.dueAtDate);
  const [links, setLinks] = useState<LinkDraft[]>(toLinkDrafts(action.links));
  const [deferDate, setDeferDate] = useState(action.deferUntilDate);
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

  // In-place updates (edit/defer) hand the updated view back and return to view
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
    setError(null);
    setMode("edit");
  }

  function startDeferring() {
    setDeferDate(action.deferUntilDate);
    setError(null);
    setMode("defer");
  }

  function cancelEditing() {
    setMode("view");
    setError(null);
  }

  if (mode === "edit") {
    const trimmedTitle = title.trim();
    const trimmedNotes = notes.trim();
    const cleanedLinks = cleanLinks(links);
    const edit: {
      title?: string;
      notes?: string | null;
      dueAt?: string | null;
      links?: GeneralActionLink[];
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
    const hasChange = Object.keys(edit).length > 0;

    return (
      <form
        className="flex flex-col gap-3 px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedTitle || !hasChange) {
            return;
          }
          runUpdate("edit", () => editGeneralActionAction({ generalActionId: action.id, edit }));
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
        <ActionLinksField links={links} onChange={setLinks} />
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
            <DropdownMenuItem onSelect={startEditing}>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
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
