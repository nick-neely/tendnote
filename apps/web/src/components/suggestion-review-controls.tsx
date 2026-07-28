"use client";

import type { RefObject } from "react";
import { CheckIcon, PencilIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { ReversibleMutationState } from "@/lib/reversible-mutation";

export function SuggestionReviewControls({
  acceptLabel = "Accept",
  dismissButtonRef,
  dismissLabel,
  dismissTitle,
  onAccept,
  onDismiss,
  onEdit,
  pending,
}: {
  acceptLabel?: string;
  dismissButtonRef: RefObject<HTMLButtonElement | null>;
  dismissLabel: string;
  dismissTitle?: string;
  onAccept: (focusTarget: HTMLElement) => void;
  onDismiss: () => void;
  onEdit: () => void;
  pending: boolean;
}) {
  return (
    <>
      <Button
        aria-label={dismissLabel}
        disabled={pending}
        onClick={onDismiss}
        ref={dismissButtonRef}
        size="sm"
        title={dismissTitle}
        type="button"
        variant="ghost"
      >
        <XIcon />
        Dismiss
      </Button>
      <Button disabled={pending} onClick={onEdit} size="sm" type="button" variant="outline">
        <PencilIcon />
        Edit
      </Button>
      <Button
        disabled={pending}
        onClick={(event) => onAccept(event.currentTarget)}
        size="sm"
        type="button"
      >
        <CheckIcon />
        {acceptLabel}
      </Button>
    </>
  );
}

export function MutationFeedback({
  error,
  pendingLabel,
}: {
  error: string | null;
  pendingLabel: string | null;
}) {
  return (
    <>
      {pendingLabel ? (
        <p className="text-muted-foreground text-sm" role="status">
          {pendingLabel}
        </p>
      ) : null}
      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function MutationUndo({
  requestUndo,
  state,
}: {
  requestUndo: () => void;
  state: ReversibleMutationState;
}) {
  if (!state.undoAvailable) return null;
  return (
    <Button
      disabled={state.undoRequested}
      onClick={requestUndo}
      size="sm"
      type="button"
      variant="outline"
    >
      {state.undoRequested ? "Undoing…" : state.labels.undo}
    </Button>
  );
}
