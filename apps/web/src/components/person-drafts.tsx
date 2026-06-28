"use client";

import { CheckIcon, CopyIcon, PencilIcon, RefreshCwIcon, SendIcon, XIcon } from "lucide-react";
import { useState, useTransition } from "react";
import {
  approveDraftAction,
  dismissDraftAction,
  editDraftBodyAction,
  markDraftSentManuallyAction,
  regenerateDraftAction,
} from "@/app/actions/drafts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DraftView } from "@/lib/draft-view";

export function PersonDrafts({ initialDrafts }: { initialDrafts: DraftView[] }) {
  const [drafts, setDrafts] = useState(initialDrafts);

  function update(view: DraftView) {
    setDrafts((current) => current.map((draft) => (draft.id === view.id ? view : draft)));
  }

  function add(view: DraftView) {
    setDrafts((current) => [view, ...current]);
  }

  if (drafts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No message drafts yet. Start one from this person to draft from their relationship context.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {drafts.map((draft) => (
        <DraftReviewCard key={draft.id} draft={draft} onAdd={add} onUpdate={update} />
      ))}
    </div>
  );
}

function DraftReviewCard({
  draft,
  onUpdate,
  onAdd,
}: {
  draft: DraftView;
  onUpdate: (view: DraftView) => void;
  onAdd: (view: DraftView) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = body.trim();
  const isActive = draft.status === "draft" || draft.status === "approved";

  function run(action: () => Promise<void>, failure: string) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch {
        setError(failure);
      }
    });
  }

  async function handleCopy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to your clipboard.");
    }
  }

  function handleApplyEdit() {
    if (!trimmed || trimmed === draft.body) {
      setIsEditing(false);
      setBody(draft.body);
      return;
    }
    run(async () => {
      const updated = await editDraftBodyAction({ draftId: draft.id, body: trimmed });
      onUpdate(updated);
      setIsEditing(false);
    }, "That edit didn't save. Try again.");
  }

  function handleCancelEdit() {
    setBody(draft.body);
    setIsEditing(false);
    setError(null);
  }

  function handleApprove() {
    run(async () => {
      onUpdate(await approveDraftAction({ draftId: draft.id }));
    }, "Couldn't approve this draft.");
  }

  function handleMarkSent() {
    run(async () => {
      onUpdate(await markDraftSentManuallyAction({ draftId: draft.id }));
    }, "Couldn't update this draft.");
  }

  function handleDismiss() {
    run(async () => {
      onUpdate(await dismissDraftAction({ draftId: draft.id }));
    }, "Couldn't dismiss this draft.");
  }

  function handleRegenerate() {
    run(async () => {
      const result = await regenerateDraftAction({ draftId: draft.id });
      if (result.draft) {
        onAdd(result.draft);
      } else {
        setError("Not enough grounded context to regenerate right now.");
      }
    }, "Couldn't regenerate this draft.");
  }

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border bg-card p-3.5"
      data-status={draft.status}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          {draft.statusLabel}
        </span>
        <span className="text-[length:var(--text-caption)] text-muted-foreground capitalize">
          {draft.purpose.replace(/_/g, " ")} · {draft.channel}
        </span>
      </div>

      {isEditing ? (
        <Textarea
          aria-label="Edit draft"
          className="min-h-28 text-[length:var(--text-body)] leading-[var(--text-body-line)]"
          onChange={(event) => setBody(event.target.value)}
          value={body}
        />
      ) : (
        <p className="max-w-[68ch] whitespace-pre-wrap text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {draft.body}
        </p>
      )}

      {draft.grounding.length ? (
        <div className="border-t pt-2.5">
          <p className="text-[length:var(--text-caption)] text-muted-foreground">
            Why this draft was written
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {draft.grounding.map((item) => (
              <li
                className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
                key={`${item.kind}:${item.trust}:${item.label}`}
              >
                <span className="font-medium text-foreground/70">{item.trustLabel}:</span>{" "}
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t pt-3">
        {isEditing ? (
          <>
            <Button onClick={handleCancelEdit} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={pending} onClick={handleApplyEdit} size="sm" type="button">
              <CheckIcon />
              Save edit
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleCopy} size="sm" type="button" variant="ghost">
              <CopyIcon />
              {copied ? "Copied" : "Copy"}
            </Button>
            {isActive ? (
              <>
                <Button
                  disabled={pending}
                  onClick={() => setIsEditing(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <PencilIcon />
                  Edit
                </Button>
                <Button
                  disabled={pending}
                  onClick={handleRegenerate}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <RefreshCwIcon />
                  Regenerate
                </Button>
                <Button
                  aria-label="Dismiss draft"
                  disabled={pending}
                  onClick={handleDismiss}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <XIcon />
                  Dismiss
                </Button>
                {draft.status === "draft" ? (
                  <Button
                    disabled={pending}
                    onClick={handleApprove}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <CheckIcon />
                    Approve
                  </Button>
                ) : null}
                <Button disabled={pending} onClick={handleMarkSent} size="sm" type="button">
                  <SendIcon />
                  Mark sent
                </Button>
              </>
            ) : null}
          </>
        )}
      </div>

      <p className="text-[length:var(--text-caption)] text-muted-foreground">
        Tendnote-only draft. Nothing is sent or created outside Tendnote — copy it to send yourself.
      </p>

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
