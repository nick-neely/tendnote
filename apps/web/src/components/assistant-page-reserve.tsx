import {
  ASSISTANT_UNSCOPED_SUBTITLE,
  AssistantComposerShell,
  AssistantMark,
  AssistantPrivateChip,
} from "@/components/assistant-panel-chrome";

/**
 * The Assistant page's 0–100 ms state, shaped like what replaces it (ADR 0207).
 *
 * The rule the dashboard reserves follow holds here too: anything already true
 * before the request resolves is rendered for real — the destination's name, the
 * privacy chip, the rail's own heading and its "New conversation" geometry — and
 * only the owner's threads and transcript are held as neutral space. Nothing in
 * this file reads owner data, so it is a plain server component.
 */

/** The page frame while the owner's conversations and thread are still reading. */
export function AssistantPageReserve() {
  return (
    <div
      aria-busy="true"
      className="flex h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] min-h-0 lg:h-[calc(100dvh-7.5rem)]"
      data-mobile-bleed
    >
      <aside
        aria-label="Loading conversations"
        className="hidden w-[260px] shrink-0 border-r bg-panel lg:block"
      >
        <div className="flex flex-col gap-2 px-2 py-3">
          {/* The button is real product copy, not owner data, so it reserves as
              itself rather than as a grey block that then moves. */}
          <div className="flex min-h-8 items-center gap-1.5 px-2.5 font-medium text-primary text-sm">
            New conversation
          </div>
          <div className="flex flex-col gap-1.5 px-2 pt-2">
            <div className="h-4 w-[7ch] animate-pulse rounded bg-muted" />
            <div className="h-7 w-full animate-pulse rounded-lg bg-muted/60" />
            <div className="h-7 w-11/12 animate-pulse rounded-lg bg-muted/60" />
            <div className="h-7 w-4/5 animate-pulse rounded-lg bg-muted/60" />
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex min-h-14 w-full max-w-[44rem] items-center gap-2 px-gutter sm:px-6">
            {/* The rail toggle is geometry here, not a control that cannot yet be
                pressed: a 28px hole keeps the title on the same line either way. */}
            <span aria-hidden className="size-7 shrink-0" />
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <h1 className="flex shrink-0 items-center gap-2 font-semibold text-sm">
                <AssistantMark />
                Assistant
              </h1>
              <span className="hidden min-w-0 truncate text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)] sm:inline">
                {ASSISTANT_UNSCOPED_SUBTITLE}
              </span>
            </div>
            <span className="hidden shrink-0 sm:inline-flex">
              <AssistantPrivateChip />
            </span>
          </div>
        </header>
        <div className="mx-auto flex min-h-0 w-full max-w-[44rem] flex-1 flex-col px-gutter sm:px-6">
          <AssistantPageTranscriptReserve />
        </div>
      </div>
    </div>
  );
}

/**
 * The transcript column alone, for the moment between the page frame arriving
 * and the panel's own chunk loading.
 *
 * The composer well is a matching box rather than a fake textarea: an input that
 * cannot be typed into would be worse than an obviously-not-yet-ready one, and
 * the height is the live composer's own (a `min-h-16` textarea over a 46px
 * toolbar inside a 1px border) so nothing shifts on the swap.
 */
export function AssistantPageTranscriptReserve() {
  return (
    <>
      <div aria-hidden className="min-h-0 flex-1" />
      <AssistantComposerShell surface="page">
        <div aria-hidden className="min-h-28 w-full rounded-lg border border-input" />
      </AssistantComposerShell>
      <div aria-hidden className="min-h-0 flex-1" />
    </>
  );
}
