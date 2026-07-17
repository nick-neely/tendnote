"use client";

import { CalendarRangeIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  acceptCalendarSuggestedFollowupAction,
  dismissCalendarSuggestedFollowupAction,
} from "@/app/actions/suggested-followups";
import { Button } from "@/components/ui/button";
import type { CalendarSuggestionReviewView } from "@/lib/calendar-suggestion-review-view";
import { useResolvingAction } from "@/lib/use-resolving-action";

/**
 * Reviewable Calendar-derived follow-up suggestions (#118). These are provider
 * context, not approved memory and not active reminders: accepting a resolved
 * suggestion promotes it through the normal follow-up lifecycle; dismissing keeps
 * its dedupe key from returning as a normal suggestion. Prompt nudges remain
 * conversation starters only and do not call these actions.
 */
export function DashboardCalendarSuggestionsSection({
  suggestions,
  onResolve,
}: {
  suggestions: CalendarSuggestionReviewView[];
  onResolve: (suggestionId: string) => void;
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 text-[length:var(--text-small)] font-medium text-muted-foreground">
        From calendar
      </h2>
      <div className="overflow-hidden rounded-xl border bg-surface">
        <ul className="divide-y">
          {suggestions.map((suggestion) => (
            <CalendarSuggestionRow
              key={suggestion.id}
              onResolve={onResolve}
              suggestion={suggestion}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function CalendarSuggestionRow({
  suggestion,
  onResolve,
}: {
  suggestion: CalendarSuggestionReviewView;
  onResolve: (suggestionId: string) => void;
}) {
  const router = useRouter();
  const displayName =
    suggestion.personName ?? suggestion.unresolvedAttendee ?? "Unresolved attendee";
  const canAccept = Boolean(suggestion.personId);
  const { leaving, error, pending, run } = useResolvingAction(() => {
    onResolve(suggestion.id);
    router.refresh();
  });

  return (
    <li
      className="flex flex-col gap-2.5 px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
    >
      <div className="flex items-center justify-between gap-2">
        {suggestion.personId ? (
          <Link
            className="min-w-0 truncate text-sm font-medium underline-offset-4 transition-colors hover:underline"
            href={`/people/${suggestion.personId}#follow-ups`}
          >
            {displayName}
          </Link>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium">{displayName}</span>
        )}
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-muted-foreground">
          <CalendarRangeIcon aria-hidden className="size-3" />
          Calendar
        </span>
      </div>

      <p className="line-clamp-3 text-pretty text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {suggestion.reason}
      </p>
      <p className="text-[length:var(--text-caption)] text-muted-foreground">
        Proposed for {suggestion.dueLabel}. Provider-derived context, not saved memory.
      </p>
      {!canAccept ? (
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          Link this attendee to a person before accepting it as a reminder.
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-1.5">
        <Button
          aria-label={`Dismiss Calendar suggestion for ${displayName}`}
          disabled={pending}
          onClick={() =>
            run(() => dismissCalendarSuggestedFollowupAction({ suggestionId: suggestion.id }))
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
          Dismiss
        </Button>
        <Button
          aria-label={`Accept Calendar suggestion for ${displayName}`}
          disabled={pending || !canAccept}
          onClick={() =>
            run(() => acceptCalendarSuggestedFollowupAction({ suggestionId: suggestion.id }))
          }
          size="sm"
          type="button"
        >
          <CheckIcon />
          Accept
        </Button>
      </div>

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
