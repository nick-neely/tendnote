"use client";

import { useState, useTransition } from "react";

/**
 * The result union every mutation server action returns: a view on success, or a
 * curated, user-safe validation message the surface renders inline.
 */
type MutationSubmitResult<TView> = { ok: true; view: TView } | { ok: false; error: string };

/**
 * Shared submit runner for surfaces that call a mutation server action and show
 * validation failures inline: it tracks pending/error state, maps an `ok: false`
 * result to the inline error, and falls back to the caller's generic message when
 * the action rejects outright. One path for the Action and Asset create forms and
 * profile controls, so the result-union handling never forks between surfaces.
 */
export function useMutationSubmit(genericError: string) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit<TView>(
    run: () => Promise<MutationSubmitResult<TView>>,
    onSuccess: (view: TView) => void | Promise<void>,
  ): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await run();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await onSuccess(result.view);
      } catch {
        setError(genericError);
      }
    });
  }

  return { error, setError, pending, submit };
}
