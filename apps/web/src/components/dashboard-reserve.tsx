import {
  ASSISTANT_UNSCOPED_SUBTITLE,
  AssistantComposerShell,
  AssistantEmptyCapture,
  AssistantPanelHeader,
  AssistantPanelShell,
} from "@/components/assistant-panel-chrome";
import { cn } from "@/lib/utils";

/**
 * The dashboard's reserves: the 0–100 ms state of each streamed region, shaped
 * like what will replace it so nothing moves when the owner's data lands
 * (ADR 0207). They are deliberately *not* generic skeletons — the assistant
 * reserve reuses the live panel's own chrome, and the rail reserve reuses the
 * real tab labels, both of which are static product copy rather than owner data.
 *
 * The rule these follow: anything already true before the request resolves is
 * rendered for real; only the owner's content is held as neutral geometry.
 */

/** Matches `DashboardGreeting`'s two lines exactly by reusing its own elements. */
export function DashboardGreetingReserve() {
  return (
    <header aria-busy="true" className="flex flex-col gap-1">
      {/* Not an `<h1>`: the greeting is a name the reserve cannot know, and a heading
          with no accessible name is worse than no heading. The type styles are the
          greeting's own, so the line boxes are identical either way. */}
      <div
        aria-hidden
        className="font-display font-semibold text-[length:var(--text-display)] leading-[var(--text-display-line)] tracking-normal"
      >
        <TextReserve className="w-[9ch]" />
      </div>
      <p aria-hidden className="text-muted-foreground text-sm">
        <TextReserve className="w-[13ch]" />
      </p>
    </header>
  );
}

/**
 * The assistant column before its owner scope resolves. Everything except the
 * composer itself is the live panel's own markup, so the swap is invisible; the
 * composer is a matching well, because a fake textarea that cannot be typed into
 * would be worse than an obviously-not-yet-ready one.
 */
export function DashboardAssistantReserve() {
  return (
    <AssistantPanelShell aria-busy="true" aria-label="Loading the assistant">
      <AssistantPanelHeader
        // The header's one affordance is the "Open" link, which is geometry
        // rather than content: it reserves as blank space of the same width
        // rather than as a control that cannot yet be pressed.
        actions={<span aria-hidden className="size-7" />}
        subtitle={ASSISTANT_UNSCOPED_SUBTITLE}
      />
      <AssistantEmptyCapture />
      <AssistantComposerShell>
        {/* The live composer's well is its `min-h-16` textarea above a 46px
            block-end toolbar, inside a 1px border: 7rem in total. Matching that
            total keeps the empty state centred in the same place before and
            after the panel arrives. */}
        <div aria-hidden className="min-h-28 w-full rounded-lg border border-input" />
      </AssistantComposerShell>
    </AssistantPanelShell>
  );
}

const RAIL_TABS = ["Today", "Follow-ups", "Review", "People"];

/**
 * The context rail before its data lands: the real tab bar with no tab claimed
 * yet, above two card-shaped regions. Selecting a tab is a colour change once
 * the rail arrives, never a reflow.
 */
export function DashboardRailReserve() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading the context rail"
      className="flex min-h-0 flex-col gap-3 lg:h-full"
    >
      <div className="inline-flex h-8 w-full shrink-0 items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground">
        {RAIL_TABS.map((label) => (
          <span
            className="inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center whitespace-nowrap rounded-md px-1.5 py-0.5 font-medium text-foreground/60 text-sm"
            key={label}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-6">
        <RailCardReserve />
        <RailCardReserve />
      </div>
    </section>
  );
}

function RailCardReserve() {
  return (
    <div className="flex flex-col gap-2.5">
      <TextReserve className="mx-1 w-[8ch] text-[length:var(--text-small)]" />
      <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}

/**
 * A neutral run of text at the exact line height of the copy it stands in for.
 * `1em` inside the surrounding element's own type styles is what keeps the
 * reserve and the resolved line the same height without restating a pixel value.
 */
function TextReserve({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-[1em] max-w-full rounded bg-muted align-middle", className)}
    />
  );
}
