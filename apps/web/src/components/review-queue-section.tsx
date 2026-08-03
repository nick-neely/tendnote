"use client";

import Link from "next/link";
import { addCapturePersonAction } from "@/app/actions/conversational-capture";
import {
  dismissSuggestedMemoryAction,
  restoreDismissedSuggestedMemoryAction,
  saveSuggestedMemoryAction,
} from "@/app/actions/memory-review";
import { AssetReviewGroupCard } from "@/components/asset-review-group-card";
import { CheckIcon, XIcon } from "@/components/icons";
import {
  type SuggestedContextFactAcceptAction,
  type SuggestedContextFactDismissAction,
  SuggestedContextFactReviewCard,
} from "@/components/suggested-context-fact-review";
import { SuggestedGeneralActionReviewCard } from "@/components/suggested-general-action-review";
import { MutationFeedback, MutationUndo } from "@/components/suggestion-review-controls";
import { Button } from "@/components/ui/button";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import {
  REVERSIBLE_MUTATION_TRANSITION_MS,
  ReversibleMutationProvider,
  useReversibleMutation,
} from "@/lib/reversible-mutation";
import {
  type ReviewQueueIdentity,
  type ReviewQueueItem,
  resolveReviewQueueItem,
  updateReviewQueueItem,
} from "@/lib/review-queue";
import type { SourceRecordReviewView } from "@/lib/source-record-review-view";
import type { SuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";
import { suggestedMemoryDismissAdapter } from "@/lib/suggestion-reversible-mutation";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

export function ReviewQueueSection({
  ...props
}: {
  heading?: string;
  items: ReviewQueueItem[];
  onResolve: (identity: ReviewQueueIdentity) => void;
  onUpdate: (item: ReviewQueueItem) => void;
  suggestedContextFactAcceptAction?: SuggestedContextFactAcceptAction;
  suggestedContextFactDismissAction?: SuggestedContextFactDismissAction;
}) {
  return (
    <ReversibleMutationProvider>
      <ReviewQueueSectionContent {...props} />
    </ReversibleMutationProvider>
  );
}

function ReviewQueueSectionContent({
  heading = "Needs review",
  items,
  onResolve,
  onUpdate,
  suggestedContextFactAcceptAction,
  suggestedContextFactDismissAction,
}: {
  heading?: string;
  items: ReviewQueueItem[];
  onResolve: (identity: ReviewQueueIdentity) => void;
  onUpdate: (item: ReviewQueueItem) => void;
  suggestedContextFactAcceptAction?: SuggestedContextFactAcceptAction;
  suggestedContextFactDismissAction?: SuggestedContextFactDismissAction;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 font-medium text-[length:var(--text-small)] text-muted-foreground">
        {heading}
      </h2>
      <ul aria-label="Review queue" className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li
            data-queue-family={item.family}
            data-queue-id={`${item.family}:${item.id}`}
            key={`${item.family}:${item.id}`}
          >
            <ReviewQueueCard
              item={item}
              onResolve={(identity) => {
                const row = Array.from(
                  document.querySelectorAll<HTMLElement>("[data-queue-id]"),
                ).find(
                  (candidate) => candidate.dataset.queueId === `${identity.family}:${identity.id}`,
                );
                const moveFocus = captureFocusAfterRemoval(row, "h2");
                onResolve(identity);
                moveFocus();
              }}
              onUpdate={onUpdate}
              suggestedContextFactAcceptAction={suggestedContextFactAcceptAction}
              suggestedContextFactDismissAction={suggestedContextFactDismissAction}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A streamed review family owns its small optimistic collection locally. */
export function ReviewQueueFamilySection({
  heading,
  initialItems,
}: {
  heading: string;
  initialItems: ReviewQueueItem[];
}) {
  const [items, setItems] = useServerSyncedList(
    initialItems,
    (item) => `${item.family}:${item.id}`,
  );
  return (
    <ReviewQueueSection
      heading={heading}
      items={items}
      onResolve={(identity) =>
        setItems(
          (current) =>
            resolveReviewQueueItem(
              { count: current.length, failures: [], items: current },
              identity,
            ).items,
        )
      }
      onUpdate={(item) =>
        setItems((current) =>
          current.some((candidate) => candidate.family === item.family && candidate.id === item.id)
            ? updateReviewQueueItem({ count: current.length, failures: [], items: current }, item)
                .items
            : [...current, item],
        )
      }
    />
  );
}

function ReviewQueueCard({
  item,
  onResolve,
  onUpdate,
  suggestedContextFactAcceptAction,
  suggestedContextFactDismissAction,
}: {
  item: ReviewQueueItem;
  onResolve: (identity: ReviewQueueIdentity) => void;
  onUpdate: (item: ReviewQueueItem) => void;
  suggestedContextFactAcceptAction?: SuggestedContextFactAcceptAction;
  suggestedContextFactDismissAction?: SuggestedContextFactDismissAction;
}) {
  if (item.family === "suggested-memory") {
    return (
      <SuggestedMemoryQueueCard
        onResolve={() => onResolve({ family: item.family, id: item.id })}
        onUpdate={(review) => onUpdate({ ...item, review })}
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

  if (item.family === "suggested-context-fact") {
    return (
      <SuggestedContextFactReviewCard
        acceptAction={suggestedContextFactAcceptAction}
        dismissAction={suggestedContextFactDismissAction}
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
  const mutation = useReversibleMutation(review.sourceRecord.id, "resolve");
  const { error, leaving, pending } = mutation.state;
  if (!mention) return null;
  return (
    <article
      aria-busy={pending}
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
          onClick={(event) =>
            mutation.run({
              kind: "pending",
              apply: () => true,
              command: () =>
                addCapturePersonAction({
                  displayName: mention.mentionText,
                  sourceRecordId: review.sourceRecord.id,
                  unresolvedMentionId: mention.id,
                }),
              focusTarget: event.currentTarget,
              labels: reviewPendingLabels("Adding person…", "Person added."),
              leave: {
                afterMs: REVERSIBLE_MUTATION_TRANSITION_MS,
                apply: () => {
                  onResolve();
                  return true;
                },
              },
            })
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
      {pending ? (
        <p className="text-muted-foreground text-sm" role="status">
          {mutation.state.labels.pending}
        </p>
      ) : null}
    </article>
  );
}

function SuggestedMemoryQueueCard({
  review,
  onResolve,
  onUpdate,
}: {
  review: SuggestedMemoryReviewView;
  onResolve: () => void;
  onUpdate: (review: SuggestedMemoryReviewView) => void;
}) {
  const { memory } = review;
  const personName = review.personName ?? "Someone";
  const dismissMutation = useReversibleMutation(memory.id, "dismiss");
  const saveMutation = useReversibleMutation(memory.id, "save");
  const pending = dismissMutation.state.pending || saveMutation.state.pending;
  const leaving = dismissMutation.state.leaving || saveMutation.state.leaving;
  const error = dismissMutation.state.error ?? saveMutation.state.error;

  function save(
    command: () => Promise<OwnerActionResult<SuggestedMemoryReviewView>>,
    focusTarget: HTMLElement,
    pendingLabel: string,
    successLabel: string,
  ) {
    saveMutation.run({
      kind: "pending",
      apply: () => true,
      command,
      focusTarget,
      labels: reviewPendingLabels(pendingLabel, successLabel),
      leave: {
        afterMs: REVERSIBLE_MUTATION_TRANSITION_MS,
        apply: () => {
          onResolve();
          return true;
        },
      },
    });
  }

  return (
    <>
      <article
        className="flex flex-col gap-2.5 rounded-xl border bg-surface px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0"
        data-leaving={leaving}
        data-memory-id={memory.id}
        aria-busy={pending}
      >
        <div className="flex items-center justify-between gap-2">
          <Link
            className="min-w-0 truncate text-sm font-medium underline-offset-4 transition-colors hover:underline"
            href={`/people/${memory.personId}#needs-review`}
          >
            {personName}
          </Link>
          {/* Neutral, not clay: the queue heading already says these rows need review, so a
              clay pill on every row spends the one accent moment §3 allows on repetition.
              The word carries the state, so the demotion loses no meaning. */}
          <span className="inline-flex shrink-0 items-center rounded-full bg-secondary px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-muted-foreground">
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
            onClick={(event) =>
              dismissMutation.run({
                kind: "optimistic",
                adapter: suggestedMemoryDismissAdapter(() =>
                  restoreDismissedSuggestedMemoryAction({ memoryId: memory.id }),
                ),
                apply: (view) => {
                  onUpdate(view);
                  return true;
                },
                command: () => dismissSuggestedMemoryAction({ memoryId: memory.id }),
                focusTarget: event.currentTarget,
                labels: {
                  ...reviewPendingLabels("Dismissing suggestion…", "Suggestion dismissed."),
                  success: "Suggestion dismissed. Undo available.",
                  undo: "Undo Dismiss",
                  undone: "Suggestion restored to review.",
                },
                leave: {
                  apply: () => {
                    onResolve();
                    return true;
                  },
                },
                prior: review,
              })
            }
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
            onClick={(event) =>
              save(
                () => saveSuggestedMemoryAction({ memoryId: memory.id }),
                event.currentTarget,
                "Saving suggestion…",
                "Suggestion saved.",
              )
            }
            size="sm"
            type="button"
          >
            <CheckIcon />
            Save
          </Button>
        </div>

        <MutationFeedback
          error={error}
          pendingLabel={
            pending
              ? dismissMutation.state.pending
                ? dismissMutation.state.labels.pending
                : saveMutation.state.labels.pending
              : null
          }
        />
      </article>
      <MutationUndo requestUndo={dismissMutation.requestUndo} state={dismissMutation.state} />
    </>
  );
}

function reviewPendingLabels(pending: string, success: string) {
  return {
    pending,
    success,
    rollback: "The review item was not changed.",
    undo: "",
    undone: "",
  };
}
