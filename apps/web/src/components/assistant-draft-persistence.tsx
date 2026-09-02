"use client";

import { useEffect, useRef, useState } from "react";
import {
  type PromptInputMessage,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import {
  consumeLocalEveDraftSubmission,
  loadLocalComposerDraft,
  saveLocalComposerDraft,
} from "@/lib/local-composer-draft";

/**
 * The composer's unsent text, mirrored to this device and handed back on return.
 *
 * It lives in its own file because it is a whole concern — hydrate once per
 * owner, consume the one-shot hand-off another surface may have left, mirror
 * every keystroke, and offer to discard — that has nothing to say about turns,
 * queues, or sessions. Rendered as a component rather than a hook because it
 * also owns the strip it draws above the composer.
 */
export function AssistantDraftPersistence({
  onSubmit,
  ownerUserId,
  ready,
}: {
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  ownerUserId: string;
  /** Whether the session can take a turn right now, i.e. eve's `status === "ready"`. */
  ready: boolean;
}) {
  const controller = usePromptInputController();
  const [hydratedOwner, setHydratedOwner] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const autoSubmitting = useRef(false);
  const loadedOwner = useRef<string | null>(null);

  // fallow-ignore-next-line complexity -- Owner hydration atomically loads, consumes the one-shot handoff, and always closes the hydration gate.
  useEffect(() => {
    if (loadedOwner.current === ownerUserId) return;
    loadedOwner.current = ownerUserId;
    try {
      const draft = loadLocalComposerDraft(window.localStorage, ownerUserId, "eve");
      const submissionRequested = consumeLocalEveDraftSubmission(window.localStorage, ownerUserId);
      if (draft.restored && !controller.textInput.value) {
        controller.textInput.setInput(draft.value);
        setRestored(true);
        if (submissionRequested) {
          setPendingSubmission(draft.value);
        }
      }
    } finally {
      setHydratedOwner(ownerUserId);
    }
  }, [controller.textInput, ownerUserId]);

  // The handed-off draft leaves the input - and, through the mirror effect
  // below, local storage - the instant it is sent, on the same optimistic
  // contract as a typed submission: only a rejected send puts it back. Waiting
  // for the turn to finish would leave a sent message sitting in the composer
  // under a "Discard draft" affordance for the whole stream.
  useEffect(() => {
    if (!pendingSubmission || !ready || autoSubmitting.current) return;
    autoSubmitting.current = true;
    controller.textInput.clear();
    void onSubmit({ files: [], text: pendingSubmission })
      .catch(() => controller.textInput.restore(pendingSubmission))
      .finally(() => {
        setPendingSubmission(null);
        autoSubmitting.current = false;
      });
  }, [controller.textInput, onSubmit, pendingSubmission, ready]);

  // The mirror tracks the composer, and the composer only ever holds *unsent*
  // text: a submission empties it optimistically, which lands here as an empty
  // value and clears the stored draft in the same commit. That is what keeps the
  // discard affordance below off an in-flight message - a draft is something the
  // user has not sent yet, never something the assistant is already answering. A
  // rejected send restores the input, and this effect writes the draft back with it.
  useEffect(() => {
    if (hydratedOwner !== ownerUserId) return;
    try {
      saveLocalComposerDraft(window.localStorage, ownerUserId, "eve", controller.textInput.value);
    } catch {
      // A blocked local store never changes the assistant's network-required behavior.
    }
    if (!controller.textInput.value) setRestored(false);
  }, [controller.textInput.value, hydratedOwner, ownerUserId]);

  if (!controller.textInput.value) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
      {restored ? (
        <p className="text-muted-foreground text-xs" role="status">
          Unsaved draft restored on this device.
        </p>
      ) : (
        <span />
      )}
      <button
        className="min-h-11 text-muted-foreground text-xs underline-offset-4 hover:underline"
        onClick={controller.textInput.clear}
        type="button"
      >
        Discard draft
      </button>
    </div>
  );
}
