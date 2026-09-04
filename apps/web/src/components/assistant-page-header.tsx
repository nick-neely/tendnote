"use client";

import { useEffect, useRef } from "react";
import { AssistantMark } from "@/components/assistant-panel-chrome";
import { NotebookPenIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

/**
 * One header for the destination: who is talking, and which thread.
 *
 * It spans the full canvas rather than the transcript's measure. Once the rail
 * is against the left edge of the window, a header row that stopped where the
 * text column stops would leave the fold control floating in the middle of the
 * page instead of sitting at the corner of the thing it folds.
 *
 * Two things that used to live here are gone. The Private chip said the standing
 * promise twice — the empty state says it in a sentence — and the debug toggle
 * was development chrome sitting permanently in a product header.
 */
export function AssistantPageHeader({
  onNewConversation,
  title,
}: {
  onNewConversation: () => void;
  title: string | null;
}) {
  const { isMobile, openMobile, state } = useSidebar();
  // The rail carries this action wherever the rail is a list. It is a header
  // control only where it is not: an icon-width rail, and a phone.
  const railOffersNewConversation = !isMobile && state === "expanded";

  /**
   * Focus comes back here when the phone's rail sheet closes.
   *
   * Radix's modal dialog does not use its usual restore for this: it explicitly
   * refocuses the `DialogTrigger`, and the sidebar's sheet is fully controlled
   * with no trigger inside it, so the ref is null and focus falls to `<body>` —
   * a keyboard or screen-reader owner who closes the rail loses their place
   * entirely. This control is the thing that opened it, so it is where the
   * place belongs, including after picking a thread: the transcript that
   * arrives is a new subject, not a new page, and the header is the top of it.
   */
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetWasOpen = useRef(false);
  useEffect(() => {
    if (sheetWasOpen.current && !openMobile) triggerRef.current?.focus();
    sheetWasOpen.current = openMobile;
  }, [openMobile]);

  return (
    // The page's height already stops above the phone's bottom bar; the top
    // inset has no such owner, so the header holds it and the transcript below
    // simply gets that much less room.
    <header className="shrink-0 border-b pt-[env(safe-area-inset-top)]">
      <div className="flex min-h-14 w-full items-center gap-2 px-gutter sm:px-6">
        {/* Named for what it reveals rather than for the fold state, so it is
            never a control whose label changes under the pointer. */}
        <SidebarTrigger
          aria-label="Conversations"
          className="-ml-1 shrink-0 text-muted-foreground"
          ref={triggerRef}
        />

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="flex shrink-0 items-center gap-2 font-semibold text-sm">
            <AssistantMark />
            Assistant
          </h1>
          {title ? (
            <>
              <span aria-hidden className="text-muted-foreground/60">
                ·
              </span>
              {/* The full title stays reachable on hover for the ones the
                  measure clips; the rail row it came from clips too. */}
              <span
                className="min-w-0 truncate text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
                title={title}
              >
                {title}
              </span>
            </>
          ) : null}
        </div>

        {railOffersNewConversation ? null : (
          <Button
            aria-label="New conversation"
            className="shrink-0 text-muted-foreground"
            onClick={onNewConversation}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <NotebookPenIcon aria-hidden />
          </Button>
        )}
      </div>
    </header>
  );
}
