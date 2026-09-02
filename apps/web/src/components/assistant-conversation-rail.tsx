"use client";

import Link from "next/link";
import { useState } from "react";
import type { AssistantConversationView } from "@/app/actions/assistant-conversations";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  ChevronDownIcon,
  ListIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  PencilIcon,
  XIcon,
} from "@/components/icons";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
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
 * It is built on the shadcn Sidebar, which is worth naming because it is not
 * decoration: the primitive already owns the three behaviours a hand-rolled rail
 * kept getting slightly wrong — a cookie-persisted fold that survives a reload,
 * an icon-width state that keeps the two standing actions reachable instead of
 * hiding the rail outright, and a phone rendering as a real sheet with focus
 * trapping and focus return. What is local is only the palette (`--sidebar-*`
 * in globals.css all point at Tendnote's own tokens) and the shapes below.
 *
 * Three things it deliberately does not do. There is no delete: a Tendnote row
 * is not the conversation, and dropping it while eve's durable stream lives on
 * would be a promise the system cannot keep — archive is the reversible answer.
 * There is no count, badge, or unread state on a live thread: a conversation
 * list is not an inbox. And the archived group is closed, and absent entirely
 * when it is empty, because an affordance that reveals nothing teaches the
 * reader to ignore it.
 */

/** What one row can be doing, so two rows are never mid-edit at once. */
type RowMode = { kind: "idle" } | { kind: "renaming"; sessionId: string; title: string };

export type AssistantConversationRailProps = {
  /** Live threads, newest activity first. */
  conversations: readonly AssistantConversationView[];
  /** Put-away threads, behind their own closed group. */
  archived: readonly AssistantConversationView[];
  /** The thread on screen, if any — including one that has just started. */
  currentSessionId: string | null;
  /** Sectioning is calendar-relative, so the boundary is the reader's own clock. */
  now: Date;
  onArchive: (sessionId: string) => Promise<void>;
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

/**
 * Selection is sage; hover is not.
 *
 * The registry spends one token — `--sidebar-accent` — on both, which would make
 * the row under the pointer indistinguishable from the row you are in. Tendnote
 * has always tinted the selected row and left hover neutral, so hover is pinned
 * back to `muted` here and only `data-active` keeps the tint. It is never colour
 * alone: the active row is also the one carrying `aria-current`.
 */
const rowClass =
  "h-9 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)] hover:bg-muted hover:text-foreground";

/** Date headings and the Archived label read as one kind of thing. */
const groupLabelClass =
  "h-7 px-2 font-normal text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]";

export function AssistantConversationRail({
  archived,
  conversations,
  currentSessionId,
  now,
  onArchive,
  onNewConversation,
  onRename,
  onUnarchive,
}: AssistantConversationRailProps) {
  const [mode, setMode] = useState<RowMode>({ kind: "idle" });
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();

  const groups = groupAssistantConversations(conversations, now);

  /** A phone reaches this rail as a sheet, and leaving it must close it. */
  function dismissOnPhone() {
    setOpenMobile(false);
  }

  async function run(sessionId: string, work: () => Promise<void>): Promise<void> {
    setBusySessionId(sessionId);
    try {
      await work();
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <Sidebar
      // The registry sidebar is a whole-window element (`fixed inset-y-0
      // h-svh`), and this one lives under Tendnote's own chrome: the app header
      // above `lg`, the phone's bottom bar below it. Pinning the two edges here
      // rather than editing the primitive keeps the file verbatim and keeps the
      // arithmetic where the shell it belongs to can be read next to it.
      className="top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] h-auto lg:top-[calc(3.5rem+1px)] lg:bottom-0"
      collapsible="icon"
    >
      {/* The sheet is edge-to-edge on a phone, so this is the only thing between
          the first row and a notch. The inset is zero everywhere else. */}
      <nav
        aria-label="Conversations"
        className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]"
      >
        <SidebarHeader className="gap-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="h-9 text-primary hover:bg-primary/10 hover:text-primary"
                onClick={() => {
                  dismissOnPhone();
                  onNewConversation();
                }}
                // A label for the icon rail, and nothing on a phone. The
                // registry keeps the tooltip mounted and merely `hidden` where
                // it does not apply, and a mounted tooltip is a dismissable
                // layer: focus lands on this button the moment the sheet opens,
                // so its tooltip would swallow the Escape that should have
                // closed the sheet, and take the focus return with it.
                tooltip={isMobile ? undefined : "New conversation"}
                type="button"
              >
                <NotebookPenIcon aria-hidden />
                <span>New conversation</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* The icon rail is not a hidden rail: it keeps the two standing
                actions, and this is the one that brings the list back. It only
                exists in that state, so it is never a second control called
                "Conversations" sitting beside the list it opens. */}
            <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
              <SidebarMenuButton
                className="h-9"
                onClick={toggleSidebar}
                tooltip={isMobile ? undefined : "Conversations"}
                type="button"
              >
                <ListIcon aria-hidden />
                <span>Conversations</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent className="group-data-[collapsible=icon]:hidden">
          {conversations.length === 0 ? (
            <p className="px-4 py-3 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              Conversations you start show up here.
            </p>
          ) : (
            groups.map((group) => (
              <SidebarGroup className="py-1" key={group.id}>
                {/* Sentence case, muted, ordinary size: a date heading is a way
                    to find a row again, not a section banner. */}
                <SidebarGroupLabel asChild className={groupLabelClass}>
                  <h2>{group.label}</h2>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
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
                        onNavigate={dismissOnPhone}
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
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))
          )}

          {archived.length > 0 ? (
            <ArchivedGroup
              busySessionId={busySessionId}
              conversations={archived}
              currentSessionId={currentSessionId}
              onNavigate={dismissOnPhone}
              onUnarchive={(sessionId) => run(sessionId, () => onUnarchive(sessionId))}
            />
          ) : null}
        </SidebarContent>

        {/* Only in the sheet. A drawer on a phone that can be dismissed only by
            reaching outside it is a drawer with no way out on a small screen. */}
        {isMobile ? (
          <div className="border-t p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <SidebarMenuButton className="h-9" onClick={dismissOnPhone} type="button">
              <XIcon aria-hidden />
              <span>Close</span>
            </SidebarMenuButton>
          </div>
        ) : null}
      </nav>
    </Sidebar>
  );
}

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
      <SidebarMenuItem>
        <form
          className="flex items-center gap-1 px-1 py-0.5"
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
          <RenameAction aria-label="Save name" disabled={busy || !renamingTo.trim()} type="submit">
            {busy ? <Spinner /> : <CheckIcon aria-hidden />}
          </RenameAction>
          <RenameAction aria-label="Cancel rename" onClick={onCancelRename} type="button">
            <XIcon aria-hidden />
          </RenameAction>
        </form>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className={rowClass} isActive={current}>
        <Link
          aria-current={current ? "page" : undefined}
          href={threadHref(conversation.sessionId)}
          onClick={onNavigate}
        >
          <span>{conversation.title}</span>
        </Link>
      </SidebarMenuButton>
      <ConversationRowMenu
        conversation={conversation}
        disabled={busy}
        onArchive={onArchive}
        onRename={onStartRename}
      />
    </SidebarMenuItem>
  );
}

/** The two buttons flanking the rename field, sized to the row they replace. */
function RenameAction({
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { "aria-label": string }) {
  return (
    <button
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-hidden ring-sidebar-ring transition-colors duration-150 ease-(--motion-ease-out) hover:bg-muted hover:text-foreground focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
    </button>
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
        {/* `showOnHover` is the primitive's own answer to the thing the rail has
            to get right: revealed by hover or keyboard focus on a fine pointer,
            always present on a coarse one. */}
        <SidebarMenuAction
          aria-label={`Actions for ${conversation.title}`}
          className="top-2 text-muted-foreground"
          disabled={disabled}
          showOnHover
        >
          <MoreHorizontalIcon aria-hidden />
        </SidebarMenuAction>
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

/**
 * Put-away threads, as a group that is closed rather than a toggle that is off.
 *
 * The distinction is the whole change: "Show archived (3)" was a control whose
 * label changed under the pointer and whose pressed state was the only clue that
 * three rows had just appeared somewhere below it. A group heading that opens
 * says the same thing in the shape the reader already knows from the date
 * headings above it, and stays where it is when it opens.
 */
function ArchivedGroup({
  busySessionId,
  conversations,
  currentSessionId,
  onNavigate,
  onUnarchive,
}: {
  busySessionId: string | null;
  conversations: readonly AssistantConversationView[];
  currentSessionId: string | null;
  onNavigate: () => void;
  onUnarchive: (sessionId: string) => void;
}) {
  return (
    <Collapsible className="group/archived" defaultOpen={false}>
      <SidebarGroup className="mt-1 border-t py-1">
        <SidebarGroupLabel asChild className={cn(groupLabelClass, "mt-1")}>
          <CollapsibleTrigger className="w-full gap-1.5 rounded-md hover:bg-muted hover:text-foreground focus-visible:ring-2">
            {/* The space is load-bearing: a flex row drops a whitespace-only
                node from the layout but the accessible name still reads it, so
                the group announces "Archived 3" rather than "Archived3". */}
            <span>Archived</span>{" "}
            <span className="tabular-nums text-muted-foreground/80">{conversations.length}</span>
            <ChevronDownIcon
              aria-hidden
              className="ml-auto transition-transform duration-150 ease-(--motion-ease-out) group-data-[state=open]/archived:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {conversations.map((conversation) => (
                <SidebarMenuItem key={conversation.sessionId}>
                  {/* An archived thread is still readable: archiving hides it
                      from the list, it does not close it (ADR 0238). */}
                  <SidebarMenuButton
                    asChild
                    className={rowClass}
                    isActive={conversation.sessionId === currentSessionId}
                  >
                    <Link
                      aria-current={
                        conversation.sessionId === currentSessionId ? "page" : undefined
                      }
                      href={threadHref(conversation.sessionId)}
                      onClick={onNavigate}
                    >
                      <span>{conversation.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    aria-label={`Restore ${conversation.title}`}
                    className="top-2 text-muted-foreground"
                    disabled={busySessionId === conversation.sessionId}
                    onClick={() => onUnarchive(conversation.sessionId)}
                    type="button"
                  >
                    {busySessionId === conversation.sessionId ? (
                      <Spinner />
                    ) : (
                      <ArchiveRestoreIcon aria-hidden />
                    )}
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
