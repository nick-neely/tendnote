"use client";

import Link from "next/link";
import { useState } from "react";
import type { AssistantConversationView } from "@/app/actions/assistant-conversations";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  PencilIcon,
  XIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { groupAssistantConversations } from "@/lib/assistant/conversation-list";
import { cn } from "@/lib/utils";

/**
 * The Assistant page's conversation list.
 *
 * Threads are Tendnote-owned titles over Eve sessions (ADR 0238), so this is the
 * only place a past conversation can be found: eve keeps no index and hands back
 * no name. Everything here is therefore about *recognition* — the owner's own
 * words as a title, sectioned by when they last used it, one line each.
 *
 * Three things it deliberately does not do. There is no delete: a Tendnote row
 * is not the conversation, and dropping it while eve's durable stream lives on
 * would be a promise the system cannot keep — archive is the reversible answer.
 * There is no count, badge, or unread state: a conversation list is not an
 * inbox. And archived threads are hidden rather than greyed, because a
 * put-away thread that still takes up a row was never put away.
 */

/** What one row can be doing, so two rows are never mid-edit at once. */
type RowMode = { kind: "idle" } | { kind: "renaming"; sessionId: string; title: string };

export type AssistantConversationRailProps = {
  /** Live threads, newest activity first. */
  conversations: readonly AssistantConversationView[];
  /** Put-away threads, hidden until the owner asks for them. */
  archived: readonly AssistantConversationView[];
  /** The thread on screen, if any — including one that has just started. */
  currentSessionId: string | null;
  /** Sectioning is calendar-relative, so the boundary is the reader's own clock. */
  now: Date;
  onArchive: (sessionId: string) => Promise<void>;
  /** Fired as a row is followed, so an overlay holding this rail can get out of the way. */
  onNavigate: () => void;
  onNewConversation: () => void;
  onRename: (sessionId: string, title: string) => Promise<void>;
  onUnarchive: (sessionId: string) => Promise<void>;
};

/**
 * Rows are links, not buttons.
 *
 * Opening a thread is a real navigation to `/assistant/[sessionId]`, which is
 * where this owner's claim on that Eve session is checked and where the back
 * button has something to come back to. Making them links also lets Next
 * prefetch the ones in view, so the check costs nothing visible.
 */
function threadHref(sessionId: string): string {
  return `/assistant/${encodeURIComponent(sessionId)}`;
}

export function AssistantConversationRail({
  archived,
  conversations,
  currentSessionId,
  now,
  onArchive,
  onNavigate,
  onNewConversation,
  onRename,
  onUnarchive,
}: AssistantConversationRailProps) {
  const [mode, setMode] = useState<RowMode>({ kind: "idle" });
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const groups = groupAssistantConversations(conversations, now);

  async function run(sessionId: string, work: () => Promise<void>): Promise<void> {
    setBusySessionId(sessionId);
    try {
      await work();
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 py-3">
      <div className="px-2">
        <Button
          className="w-full justify-start text-primary hover:bg-primary/10 hover:text-primary"
          onClick={onNewConversation}
          type="button"
          variant="ghost"
        >
          <NotebookPenIcon aria-hidden data-icon="inline-start" />
          New conversation
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            Conversations you start show up here.
          </p>
        ) : (
          groups.map((group) => (
            <section className="pb-2" key={group.id}>
              {/* Sentence case, muted, ordinary size: a date heading is a way to
                  find a row again, not a section banner. */}
              <h2 className="px-2 pt-2 pb-1 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                {group.label}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {group.conversations.map((conversation) => (
                  <ConversationRow
                    busy={busySessionId === conversation.sessionId}
                    conversation={conversation}
                    current={conversation.sessionId === currentSessionId}
                    key={conversation.sessionId}
                    onArchive={() =>
                      run(conversation.sessionId, () => onArchive(conversation.sessionId))
                    }
                    onCancelRename={() => setMode({ kind: "idle" })}
                    onEditTitle={(title) =>
                      setMode({ kind: "renaming", sessionId: conversation.sessionId, title })
                    }
                    onNavigate={onNavigate}
                    onSaveRename={async (title) => {
                      await run(conversation.sessionId, () =>
                        onRename(conversation.sessionId, title),
                      );
                      setMode({ kind: "idle" });
                    }}
                    onStartRename={() =>
                      setMode({
                        kind: "renaming",
                        sessionId: conversation.sessionId,
                        title: conversation.title,
                      })
                    }
                    renamingTo={
                      mode.kind === "renaming" && mode.sessionId === conversation.sessionId
                        ? mode.title
                        : null
                    }
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {/* Only offered once there is something behind it. An always-present
            "Show archived" that reveals nothing teaches the owner to ignore it. */}
        {archived.length > 0 ? (
          <div className="flex flex-col gap-0.5 border-t pt-2">
            <button
              className="min-h-9 rounded-lg px-2 text-left text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
              onClick={() => setShowArchived((shown) => !shown)}
              type="button"
            >
              {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
            </button>
            {showArchived
              ? archived.map((conversation) => (
                  <ArchivedRow
                    busy={busySessionId === conversation.sessionId}
                    conversation={conversation}
                    current={conversation.sessionId === currentSessionId}
                    key={conversation.sessionId}
                    onNavigate={onNavigate}
                    onUnarchive={() =>
                      run(conversation.sessionId, () => onUnarchive(conversation.sessionId))
                    }
                  />
                ))
              : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The selected row's sage tint, shared so the two row kinds cannot drift. */
const rowClass =
  "flex min-h-9 w-full items-center rounded-lg px-2 text-left text-[length:var(--text-small)] leading-[var(--text-small-line)] transition-colors duration-150 ease-(--motion-ease-out) focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35 motion-reduce:transition-none";

function ConversationRow({
  busy,
  conversation,
  current,
  onArchive,
  onCancelRename,
  onEditTitle,
  onNavigate,
  onSaveRename,
  onStartRename,
  renamingTo,
}: {
  busy: boolean;
  conversation: AssistantConversationView;
  current: boolean;
  onArchive: () => void;
  onCancelRename: () => void;
  onEditTitle: (title: string) => void;
  onNavigate: () => void;
  onSaveRename: (title: string) => Promise<void>;
  onStartRename: () => void;
  renamingTo: string | null;
}) {
  if (renamingTo !== null) {
    return (
      <li>
        <form
          className="flex items-center gap-1 py-0.5"
          onSubmit={(event) => {
            event.preventDefault();
            const title = renamingTo.trim();
            if (title) void onSaveRename(title);
          }}
        >
          <Input
            aria-label={`Rename ${conversation.title}`}
            autoFocus
            className="h-8 min-w-0 flex-1"
            maxLength={120}
            onChange={(event) => onEditTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelRename();
            }}
            value={renamingTo}
          />
          <Button
            aria-label="Save name"
            disabled={busy || !renamingTo.trim()}
            size="icon-sm"
            type="submit"
            variant="ghost"
          >
            {busy ? <Spinner /> : <CheckIcon />}
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
    <li className="group/row relative">
      <Link
        aria-current={current ? "page" : undefined}
        className={cn(
          rowClass,
          // Selection is sage, as everywhere else in the product, and it is not
          // the *only* signal: the row is also the one carrying aria-current.
          current
            ? "bg-primary/10 font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          // Room for the menu, which is always present on coarse pointers and
          // revealed by hover or keyboard focus on fine ones.
          "pr-8",
        )}
        href={threadHref(conversation.sessionId)}
        onClick={onNavigate}
      >
        <span className="truncate">{conversation.title}</span>
      </Link>
      <ConversationRowMenu
        conversation={conversation}
        disabled={busy}
        onArchive={onArchive}
        onRename={onStartRename}
      />
    </li>
  );
}

function ConversationRowMenu({
  conversation,
  disabled,
  onArchive,
  onRename,
}: {
  conversation: AssistantConversationView;
  disabled: boolean;
  onArchive: () => void;
  onRename: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Actions for ${conversation.title}`}
          className={cn(
            "-translate-y-1/2 absolute top-1/2 right-1 text-muted-foreground opacity-0",
            "group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100",
            "[@media(hover:none)]:opacity-100",
          )}
          disabled={disabled}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onRename}>
          <PencilIcon aria-hidden />
          Rename
        </DropdownMenuItem>
        {/* No Delete. Tendnote cannot erase eve's durable stream, so a delete
            that only dropped this row would claim more than it does (ADR 0238). */}
        <DropdownMenuItem onSelect={onArchive}>
          <ArchiveIcon aria-hidden />
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArchivedRow({
  busy,
  conversation,
  current,
  onNavigate,
  onUnarchive,
}: {
  busy: boolean;
  conversation: AssistantConversationView;
  current: boolean;
  onNavigate: () => void;
  onUnarchive: () => void;
}) {
  return (
    <div className="group/row relative">
      {/* An archived thread is still readable: archiving hides it from the list,
          it does not close it (ADR 0238). */}
      <Link
        aria-current={current ? "page" : undefined}
        className={cn(
          rowClass,
          "pr-8",
          current
            ? "bg-primary/10 font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        href={threadHref(conversation.sessionId)}
        onClick={onNavigate}
      >
        <span className="truncate">{conversation.title}</span>
      </Link>
      <Button
        aria-label={`Restore ${conversation.title}`}
        className="-translate-y-1/2 absolute top-1/2 right-1 text-muted-foreground"
        disabled={busy}
        onClick={onUnarchive}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {busy ? <Spinner /> : <ArchiveRestoreIcon aria-hidden />}
      </Button>
    </div>
  );
}
