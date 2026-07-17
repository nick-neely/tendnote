"use client";

import { useState, useTransition } from "react";

/**
 * How long a resolved card stays mounted while its leave transition plays. Must
 * stay in step with the `duration-200` leave animation the cards declare, so the
 * row is removed exactly as it finishes fading rather than snapping out early.
 */
const LEAVE_TRANSITION_MS = 200;

const GENERIC_ERROR = "That didn't go through. Try again.";

/**
 * Shared runner for a dashboard card that resolves itself out of a list: it tracks
 * pending/error state, marks the card `leaving` on success so its exit transition
 * plays, and hands control back to the caller once that transition has run.
 *
 * One path for the follow-up, suggested-follow-up, calendar-suggestion, and review-queue
 * cards, so the optimistic-removal timing never drifts between surfaces. A failure
 * leaves the card in place with an inline message — a card only disappears once its
 * action has actually succeeded.
 *
 * `onResolved` runs after the leave transition; it is where the caller drops the item
 * from its list (and refreshes the router, where the surface needs server state re-read).
 */
export function useResolvingAction(onResolved: () => void) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setLeaving(true);
        window.setTimeout(onResolved, LEAVE_TRANSITION_MS);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return { leaving, error, setError, pending, run };
}
