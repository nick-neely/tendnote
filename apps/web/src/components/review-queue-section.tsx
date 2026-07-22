"use client";

import { CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { addCapturePersonAction } from "@/app/actions/conversational-capture";
import {
  dismissSuggestedMemoryAction,
  saveSuggestedMemoryAction,
} from "@/app/actions/memory-review";
import { AssetReviewGroupCard } from "@/components/asset-review-group-card";
import { SuggestedGeneralActionReviewCard } from "@/components/suggested-general-action-review";
import { Button } from "@/components/ui/button";
import type { ReviewQueueIdentity, ReviewQueueItem } from "@/lib/review-queue";
import type { SourceRecordReviewView } from "@/lib/source-record-review-view";
import type { SuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";
import { useResolvingAction } from "@/lib/use-resolving-action";

export function ReviewQueueSection({
  items,
  onResolve,
  onUpdate,
}: {
  items: ReviewQueueItem[];
  onResolve: (identity: ReviewQueueIdentity) => void;
  onUpdate: (item: ReviewQueueItem) => void;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 font-medium text-[length:var(--text-small)] text-muted-foreground">
        Needs review
      </h2>
      <ul aria-label="Review queue" className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li data-queue-family={item.family} key={`${item.family}:${item.id}`}>
            <ReviewQueueCard item={item} onResolve={onResolve} onUpdate={onUpdate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewQueueCard({
  item,
  onResolve,
  onUpdate,
}: {
  item: ReviewQueueItem;
  onResolve: (identity: ReviewQueueIdentity) => void;
  onUpdate: (item: ReviewQueueItem) => void;
}) {
  if (item.family === "suggested-memory") {
    return (
      <SuggestedMemoryQueueCard
        onResolve={() => onResolve({ family: item.family, id: item.id })}
        review={item.review}
      />
    );
  }

  if (item.family === "suggested-general-action") {
    return (
      <SuggestedGeneralActionReviewCard
        onResolve={() => onResolve({ family: item.family, id: item.id })}
        onUpdate={(review) => onUpdate({ ...item, review })}
        review={item.review}
      />
    );
  }

  if (item.family === "source-record") {
    return (
      <SourceRecordQueueCard
        onResolve={() => onResolve({ family: item.family, id: item.id })}
        review={item.review}
      />
    );
  }

  return (
    <AssetReviewGroupCard
      onResolve={() => onResolve({ family: item.family, id: item.id })}
      onUpdate={(review) => onUpdate({ ...item, review })}
      review={item.review}
    />
  );
}

function SourceRecordQueueCard({
  review,
  onResolve,
}: {
  review: SourceRecordReviewView;
  onResolve: () => void;
}) {
  const mention = review.unresolvedMentions[0];
  const { leaving, error, pending, run } = useResolvingAction(onResolve);
  if (!mention) return null;
  return (
    <article
      className="flex flex-col gap-2.5 rounded-xl border bg-surface px-4 py-3 transition-opacity data-[leaving=true]:opacity-0"
      data-leaving={leaving}
      data-source-record-id={review.sourceRecord.id}
    >
      <div>
        <p className="text-sm font-medium">Who is {mention.mentionText}?</p>
        <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
          {review.sourceRecord.content}
        </p>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button asChild className="min-h-11" size="sm" variant="ghost">
          <Link href={`/people?linkSourceRecord=${review.sourceRecord.id}`}>Link someone else</Link>
        </Button>
        <Button
          className="min-h-11"
          disabled={pending}
          onClick={() =>
            run(() =>
              addCapturePersonAction({
                displayName: mention.mentionText,
                sourceRecordId: review.sourceRecord.id,
                unresolvedMentionId: mention.id,
              }),
            )
          }
          size="sm"
          type="button"
        >
          Add {mention.mentionText}
        </Button>
      </div>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function SuggestedMemoryQueueCard({
  review,
  onResolve,
}: {
  review: SuggestedMemoryReviewView;
  onResolve: () => void;
}) {
  const { memory } = review;
  const personName = review.personName ?? "Someone";
  const { leaving, error, pending, run } = useResolvingAction(onResolve);

  return (
    <article
      className="flex flex-col gap-2.5 rounded-xl border bg-surface px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0"
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
    </article>
  );
}
