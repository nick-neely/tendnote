"use client";

import type { PromptNudge } from "@tendnote/domain";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { CalendarDotsIcon } from "@/components/icons";

/**
 * Calendar-derived prompt nudges above the assistant composer (Phase 2C, #114).
 *
 * A thin wrapper over the AI Elements Suggestion component: each nudge is a
 * one-click conversation starter that SENDS its prompt to Eve via `onSelect`. It is
 * NOT a review action — there is no accept/dismiss/edit here; persisted review cards
 * remain the surface for accepting or dismissing suggested follow-ups. Renders
 * nothing when there are no nudges.
 */
export function AssistantPromptNudges({
  nudges,
  onSelect,
  disabled = false,
}: {
  nudges: PromptNudge[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}) {
  if (nudges.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
        <CalendarDotsIcon aria-hidden className="size-3 shrink-0" />
        From your calendar
      </span>
      <Suggestions>
        {nudges.map((nudge) => (
          // `suggestion` is the text sent to Eve; the visible label can be shorter.
          <Suggestion
            // Full prompt as the accessible name so a truncated visible label still
            // reads the complete intent to screen readers.
            aria-label={nudge.prompt}
            disabled={disabled}
            key={nudge.id}
            onClick={onSelect}
            suggestion={nudge.prompt}
          >
            {nudge.label}
          </Suggestion>
        ))}
      </Suggestions>
    </div>
  );
}
