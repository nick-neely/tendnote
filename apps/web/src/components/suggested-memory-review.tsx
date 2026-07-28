"use client";

import type { Sensitivity } from "@tendnote/domain";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  archiveSuggestedMemoryAction,
  dismissSuggestedMemoryAction,
  editSuggestedMemoryAction,
  saveSuggestedMemoryAction,
} from "@/app/actions/memory-review";
import { ArchiveIcon, CheckIcon, PencilIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";
import type { SuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

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
  initialReviews,
}: {
  initialReviews: SuggestedMemoryReviewView[];
}) {
  const router = useRouter();
  const [reviews, setReviews] = useState(initialReviews);

  function resolve(memoryId: string) {
    setReviews((current) => current.filter((review) => review.memory.id !== memoryId));
    // Re-read the server so the tab count drops and a saved suggestion appears
    // under Memory; client state (active tab) survives the refresh.
    router.refresh();
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
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmedDraft = draftContent.trim();
  const sensitivityChanged = sensitivity !== memory.sensitivity;
  const contentChanged = trimmedDraft !== memory.content;

  function buildEdit() {
    return {
      ...(contentChanged && trimmedDraft ? { content: trimmedDraft } : {}),
      ...(sensitivityChanged ? { sensitivity } : {}),
    };
  }

  function leaveThen(action: () => Promise<void>) {
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

  function handleSave() {
    leaveThen(async () => {
      unwrapOwnerActionResult(
        await saveSuggestedMemoryAction({ memoryId: memory.id, edit: buildEdit() }),
      );
    });
  }

  function handleDismiss() {
    leaveThen(async () => {
      unwrapOwnerActionResult(await dismissSuggestedMemoryAction({ memoryId: memory.id }));
    });
  }

  function handleArchive() {
    leaveThen(async () => {
      unwrapOwnerActionResult(await archiveSuggestedMemoryAction({ memoryId: memory.id }));
    });
  }

  function handleApplyEdit() {
    if (!trimmedDraft) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const updated = unwrapOwnerActionResult(
          await editSuggestedMemoryAction({
            memoryId: memory.id,
            edit: { content: trimmedDraft, ...(sensitivityChanged ? { sensitivity } : {}) },
          }),
        );
        onUpdate(updated);
        setIsEditing(false);
      } catch {
        setError("That edit didn't save. Try again.");
      }
    });
  }

  function handleCancelEdit() {
    setDraftContent(memory.content);
    setIsEditing(false);
    setError(null);
  }

  return (
    <article
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

      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-3">
        <div className="flex flex-col gap-1">
          <span
            className="text-[length:var(--text-caption)] text-muted-foreground"
            id={`${memory.id}-sensitivity`}
          >
            Sensitivity
          </span>
          <Select
            onValueChange={(value) => setSensitivity(value as Sensitivity)}
            value={sensitivity}
          >
            <SelectTrigger
              aria-labelledby={`${memory.id}-sensitivity`}
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
            <Button onClick={handleCancelEdit} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={pending || !trimmedDraft}
              onClick={handleApplyEdit}
              size="sm"
              type="button"
              variant="outline"
            >
              Apply edit
            </Button>
            <Button
              disabled={pending || !trimmedDraft}
              onClick={handleSave}
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
              onClick={handleDismiss}
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
              onClick={handleArchive}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ArchiveIcon />
            </Button>
            <Button
              disabled={pending}
              onClick={() => setIsEditing(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <PencilIcon />
              Edit
            </Button>
            <Button disabled={pending} onClick={handleSave} size="sm" type="button">
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

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
