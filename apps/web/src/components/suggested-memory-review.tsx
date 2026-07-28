"use client";

import type { Sensitivity } from "@tendnote/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  archiveSuggestedMemoryAction,
  dismissSuggestedMemoryAction,
  editSuggestedMemoryAction,
  restoreDismissedSuggestedMemoryAction,
  saveSuggestedMemoryAction,
} from "@/app/actions/memory-review";
import { ArchiveIcon, CheckIcon, PencilIcon, XIcon } from "@/components/icons";
import { MutationFeedback, MutationUndo } from "@/components/suggestion-review-controls";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import {
  REVERSIBLE_MUTATION_TRANSITION_MS,
  ReversibleMutationProvider,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";
import type { SuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";
import { suggestedMemoryDismissAdapter } from "@/lib/suggestion-reversible-mutation";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

const SENSITIVITY_OPTIONS: { value: Sensitivity; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "sensitive", label: "Sensitive" },
  { value: "restricted", label: "Restricted" },
];

const SOURCE_LABELS: Record<string, string> = {
  manual: "manual note",
  agent: "assistant note",
  contact_import: "imported contact",
  calendar: "calendar",
  gmail: "email",
  seed: "sample data",
};

function formatCaptured(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMemoryType(memoryType: string): string {
  const words = memoryType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SuggestedMemoryReviewSection({
  ...props
}: {
  initialReviews: SuggestedMemoryReviewView[];
}) {
  return (
    <ReversibleMutationProvider>
      <SuggestedMemoryReviewSectionContent {...props} />
    </ReversibleMutationProvider>
  );
}

function SuggestedMemoryReviewSectionContent({
  initialReviews,
}: {
  initialReviews: SuggestedMemoryReviewView[];
}) {
  const router = useRouter();
  const [reviews, setReviews] = useServerSyncedList(initialReviews, (review) => review.memory.id);

  function resolve(memoryId: string) {
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-memory-id]")).find(
      (candidate) => candidate.dataset.memoryId === memoryId,
    );
    const moveFocus = captureFocusAfterRemoval(row);
    setReviews((current) => current.filter((review) => review.memory.id !== memoryId));
    // Re-read the server so the tab count drops and a saved suggestion appears
    // under Memory; client state (active tab) survives the refresh.
    router.refresh();
    moveFocus();
  }

  function update(view: SuggestedMemoryReviewView) {
    setReviews((current) =>
      current.map((review) => (review.memory.id === view.memory.id ? view : review)),
    );
  }

  if (reviews.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing waiting to review.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {reviews.map((review) => (
        <SuggestedMemoryReviewCard
          key={review.memory.id}
          onResolve={resolve}
          onUpdate={update}
          review={review}
        />
      ))}
    </div>
  );
}

function SuggestedMemoryReviewCard({
  review,
  onResolve,
  onUpdate,
}: {
  review: SuggestedMemoryReviewView;
  onResolve: (memoryId: string) => void;
  onUpdate: (view: SuggestedMemoryReviewView) => void;
}) {
  const { memory, source, component } = review;
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(memory.content);
  const [sensitivity, setSensitivity] = useState<Sensitivity>(memory.sensitivity);
  const dismissMutation = useReversibleMutation(memory.id, "dismiss");
  const pendingMutation = useReversibleMutation(memory.id, "pending");
  const active = useActiveReversibleMutation(memory.id, ["dismiss", "pending"]);
  const pending = Boolean(active?.state.pending);
  const leaving = Boolean(active?.state.leaving);
  const error = active?.state.error ?? null;

  const trimmedDraft = draftContent.trim();
  const sensitivityChanged = sensitivity !== memory.sensitivity;
  const contentChanged = trimmedDraft !== memory.content;

  function buildEdit() {
    return {
      ...(contentChanged && trimmedDraft ? { content: trimmedDraft } : {}),
      ...(sensitivityChanged ? { sensitivity } : {}),
    };
  }

  function leaveThen<TView>(
    action: () => Promise<OwnerActionResult<TView>>,
    focusTarget: HTMLElement,
  ) {
    pendingMutation.run({
      kind: "pending",
      apply: () => true,
      command: action,
      focusTarget,
      labels: pendingLabels("Updating suggested memory…", "Suggested memory updated."),
      leave: {
        afterMs: REVERSIBLE_MUTATION_TRANSITION_MS,
        apply: () => {
          onResolve(memory.id);
          return true;
        },
      },
    });
  }

  function handleSave(focusTarget: HTMLElement) {
    leaveThen(
      () => saveSuggestedMemoryAction({ memoryId: memory.id, edit: buildEdit() }),
      focusTarget,
    );
  }

  function handleDismiss(focusTarget: HTMLElement) {
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
      focusTarget,
      labels: {
        ...pendingLabels("Dismissing suggested memory…", "Suggested memory dismissed."),
        success: "Suggested memory dismissed. Undo available.",
        undo: "Undo Dismiss",
        undone: "Suggested memory restored to review.",
      },
      leave: {
        apply: () => {
          onResolve(memory.id);
          return true;
        },
      },
      prior: review,
    });
  }

  function handleArchive(focusTarget: HTMLElement) {
    leaveThen(() => archiveSuggestedMemoryAction({ memoryId: memory.id }), focusTarget);
  }

  function handleApplyEdit(focusTarget: HTMLElement) {
    if (!trimmedDraft) {
      return;
    }

    pendingMutation.run({
      kind: "pending",
      apply: (updated) => {
        onUpdate(updated);
        setIsEditing(false);
        return true;
      },
      command: () =>
        editSuggestedMemoryAction({
          memoryId: memory.id,
          edit: { content: trimmedDraft, ...(sensitivityChanged ? { sensitivity } : {}) },
        }),
      focusTarget,
      labels: pendingLabels("Saving suggested memory edit…", "Suggested memory updated."),
    });
  }

  function handleCancelEdit() {
    setDraftContent(memory.content);
    setIsEditing(false);
  }

  return (
    <>
      <article
        aria-busy={pending}
        className="flex flex-col gap-3 rounded-lg border bg-card p-3.5 transition-[opacity,transform,border-color] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 hover:border-foreground/15"
        data-component-type={component.type}
        data-leaving={leaving}
        data-memory-id={component.memoryId}
        data-source-record-id={component.sourceRecordId}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            Suggested
          </span>
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            {formatMemoryType(memory.memoryType)}
          </span>
        </div>

        {isEditing ? (
          <Textarea
            aria-label="Edit suggested memory"
            className="min-h-20 text-[length:var(--text-body)] leading-[var(--text-body-line)]"
            onChange={(event) => setDraftContent(event.target.value)}
            value={draftContent}
          />
        ) : (
          <p className="max-w-[68ch] text-[length:var(--text-body)] leading-[var(--text-body-line)]">
            {memory.content}
          </p>
        )}

        {source ? (
          <div className="border-t pt-2.5">
            <p className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
              From {SOURCE_LABELS[source.sourceType] ?? source.sourceType} · captured{" "}
              {formatCaptured(source.capturedAt)}
            </p>
            <p className="mt-1 line-clamp-2 max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              {source.content}
            </p>
          </div>
        ) : null}

        <SuggestedMemoryControls
          canSubmit={Boolean(trimmedDraft)}
          isEditing={isEditing}
          memoryId={memory.id}
          onApplyEdit={handleApplyEdit}
          onArchive={handleArchive}
          onCancelEdit={handleCancelEdit}
          onDismiss={handleDismiss}
          onEdit={() => setIsEditing(true)}
          onSave={handleSave}
          pending={pending}
          sensitivity={sensitivity}
          setSensitivity={setSensitivity}
        />

        <MutationFeedback
          error={error}
          pendingLabel={pending ? (active?.state.labels.pending ?? null) : null}
        />
      </article>
      <MutationUndo requestUndo={dismissMutation.requestUndo} state={dismissMutation.state} />
    </>
  );
}

function SuggestedMemoryControls({
  canSubmit,
  isEditing,
  memoryId,
  onApplyEdit,
  onArchive,
  onCancelEdit,
  onDismiss,
  onEdit,
  onSave,
  pending,
  sensitivity,
  setSensitivity,
}: {
  canSubmit: boolean;
  isEditing: boolean;
  memoryId: string;
  onApplyEdit: (focusTarget: HTMLElement) => void;
  onArchive: (focusTarget: HTMLElement) => void;
  onCancelEdit: () => void;
  onDismiss: (focusTarget: HTMLElement) => void;
  onEdit: () => void;
  onSave: (focusTarget: HTMLElement) => void;
  pending: boolean;
  sensitivity: Sensitivity;
  setSensitivity: (value: Sensitivity) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-3">
        <div className="flex flex-col gap-1">
          <span
            className="text-[length:var(--text-caption)] text-muted-foreground"
            id={`${memoryId}-sensitivity`}
          >
            Sensitivity
          </span>
          <Select
            onValueChange={(value) => setSensitivity(value as Sensitivity)}
            value={sensitivity}
          >
            <SelectTrigger
              aria-labelledby={`${memoryId}-sensitivity`}
              className="h-8 w-36"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SENSITIVITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <Button onClick={onCancelEdit} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={pending || !canSubmit}
              onClick={(event) => onApplyEdit(event.currentTarget)}
              size="sm"
              type="button"
              variant="outline"
            >
              Apply edit
            </Button>
            <Button
              disabled={pending || !canSubmit}
              onClick={(event) => onSave(event.currentTarget)}
              size="sm"
              type="button"
            >
              <CheckIcon />
              Save
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Button
              aria-label="Dismiss suggestion"
              disabled={pending}
              onClick={(event) => onDismiss(event.currentTarget)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <XIcon />
              Dismiss
            </Button>
            <Button
              aria-label="Archive suggestion"
              disabled={pending}
              onClick={(event) => onArchive(event.currentTarget)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ArchiveIcon />
            </Button>
            <Button disabled={pending} onClick={onEdit} size="sm" type="button" variant="outline">
              <PencilIcon />
              Edit
            </Button>
            <Button
              disabled={pending}
              onClick={(event) => onSave(event.currentTarget)}
              size="sm"
              type="button"
            >
              <CheckIcon />
              Save
            </Button>
          </div>
        )}
      </div>
      {sensitivity === "restricted" ? (
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          Restricted memories stay out of suggestions and reminders unless you ask for them.
        </p>
      ) : null}
    </>
  );
}

function pendingLabels(pending: string, success: string) {
  return {
    pending,
    success,
    rollback: "The suggested memory was not changed.",
    undo: "",
    undone: "",
  };
}
