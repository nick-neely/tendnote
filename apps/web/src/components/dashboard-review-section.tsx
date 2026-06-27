"use client";

import { CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  dismissSuggestedMemoryAction,
  saveSuggestedMemoryAction,
} from "@/app/actions/memory-review";
import { Button } from "@/components/ui/button";
import type { SuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

/** A pending suggestion as shown on the dashboard rail. */
export type DashboardReviewView = SuggestedMemoryReviewView;

/**
 * Pending suggested-memory reviews surfaced inline on the dashboard so the common
 * case — approve or dismiss — happens without opening each person. The full
 * review (edit, sensitivity, archive) still lives on the person's ledger, which
 * the person name links to. The whole section removes itself once the last
 * suggestion is resolved; an empty review queue is not worth a heading.
 */
export function DashboardReviewSection({
  initialReviews,
}: {
  initialReviews: DashboardReviewView[];
}) {
  const [reviews, setReviews] = useState(initialReviews);

  function resolve(memoryId: string) {
    setReviews((current) => current.filter((review) => review.memory.id !== memoryId));
  }

  if (reviews.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 text-[length:var(--text-small)] font-medium text-muted-foreground">
        Needs review
      </h2>
      <div className="overflow-hidden rounded-xl border bg-surface">
        <ul className="divide-y">
          {reviews.map((review) => (
            <ReviewRow key={review.memory.id} onResolve={resolve} review={review} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReviewRow({
  review,
  onResolve,
}: {
  review: DashboardReviewView;
  onResolve: (memoryId: string) => void;
}) {
  const { memory } = review;
  const personName = review.personName ?? "Someone";
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setLeaving(true);
        window.setTimeout(() => onResolve(memory.id), 200);
      } catch {
        setError("That didn't go through. Try again.");
      }
    });
  }

  return (
    <li
      className="flex flex-col gap-2.5 px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0"
      data-leaving={leaving}
      data-memory-id={memory.id}
    >
      <div className="flex items-center justify-between gap-2">
        <Link
          className="min-w-0 truncate text-sm font-medium underline-offset-4 transition-colors hover:underline"
          href={`/people/${memory.personId}#needs-review`}
        >
          {personName}
        </Link>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          Suggested
        </span>
      </div>

      <p className="line-clamp-3 text-pretty text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {memory.content}
      </p>

      <div className="flex items-center justify-end gap-1.5">
        <Button
          aria-label={`Dismiss suggestion about ${personName}`}
          disabled={pending}
          onClick={() => run(() => dismissSuggestedMemoryAction({ memoryId: memory.id }))}
          size="sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
          Dismiss
        </Button>
        <Button
          aria-label={`Save suggestion about ${personName}`}
          disabled={pending}
          onClick={() => run(() => saveSuggestedMemoryAction({ memoryId: memory.id }))}
          size="sm"
          type="button"
        >
          <CheckIcon />
          Save
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
