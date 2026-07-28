"use client";

import { useState, useTransition } from "react";
import { listGeneralActionHistoryAction } from "@/app/actions/general-actions";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionEventView } from "@/lib/general-action-view";

/**
 * A calm history timeline for one Action: what happened and when, oldest first.
 * Explains the Action's story without productivity analytics — no durations,
 * streaks, or scoring (ADR 0165). Events lazy-load when the dialog opens so the
 * list surface stays light.
 */
export function ActionHistoryDialog({
  generalActionId,
  title,
  open,
  onOpenChange,
}: {
  generalActionId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [events, setEvents] = useState<GeneralActionEventView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next && events === null && !pending) {
      setError(null);
      startTransition(async () => {
        try {
          const result = await listGeneralActionHistoryAction({ generalActionId });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setEvents(result.view);
        } catch {
          setError(GENERIC_ERROR);
        }
      });
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="flex items-center gap-2 py-4 text-[length:var(--text-small)] text-muted-foreground">
            <Spinner className="size-4" />
            Loading history…
          </div>
        ) : error ? (
          <ErrorText message={error} />
        ) : events?.length ? (
          <ol className="flex flex-col">
            {events.map((event, index) => (
              <li className="flex gap-3" key={event.id}>
                <div className="flex flex-col items-center" aria-hidden>
                  <span className="mt-1.5 size-2 rounded-full bg-primary/60" />
                  {index < events.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                </div>
                <div className="flex flex-1 items-baseline justify-between gap-3 pb-4">
                  <span className="text-[length:var(--text-body)]">{event.label}</span>
                  <time
                    className="shrink-0 font-mono text-[length:var(--text-caption)] text-muted-foreground"
                    dateTime={event.atISO}
                  >
                    {event.atLabel}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-4 text-[length:var(--text-small)] text-muted-foreground">
            No history yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
