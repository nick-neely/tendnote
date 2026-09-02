"use client";

import { useEffect, useState } from "react";
import { loadMobileEveContextAction } from "@/app/actions/eve-context";
import { AssistantPanel } from "@/components/assistant-panel";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";

type EveContext =
  Awaited<ReturnType<typeof loadMobileEveContextAction>> extends infer TResult
    ? TResult extends { ok: true; view: infer TView }
      ? TView
      : never
    : never;

/** Loads the assistant's optional owner context only after the owner opens it. */
export function EveSurface({ ownerUserId }: { ownerUserId: string }) {
  const [context, setContext] = useState<EveContext | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    if (attempt > 0) setContext(null);
    setFailed(false);
    void loadMobileEveContextAction()
      .then((next) => {
        if (current) setContext(unwrapOwnerActionResult(next));
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  if (failed) {
    return <MobileFailureState kind="eve" onRetry={() => setAttempt((value) => value + 1)} />;
  }
  if (!context) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading the assistant"
        className="h-full animate-pulse bg-muted/40"
      />
    );
  }
  return (
    <AssistantPanel
      nudges={context.nudges}
      ownerUserId={ownerUserId}
      suggestPersonName={context.suggestPersonName}
      // The phone's flow already owns a header and a gutter, so the panel sheds
      // its own card: one title, one border, no nesting (DESIGN.md §5).
      surface="bleed"
    />
  );
}
