"use client";

import { ArrowUpRightIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  dismissSuggestedMemoryAction,
  saveSuggestedMemoryAction,
} from "@/app/actions/memory-review";
import { Body, Caption, type CardTone, ResultCard } from "@/components/assistant-result-card";
import { Button } from "@/components/ui/button";
import type { AssistantToolView, SuggestedReviewItemView } from "@/lib/eve/tool-result-view";

type Outcome = "pending" | "saved" | "dismissed";

/**
 * Renders the interactive review cards for a `list_suggested_memory_reviews`
 * result — the "what do I have to review?" path, where one tool call returns
 * every open suggestion so they all render at once. Empty resolves to nothing;
 * the assistant's own reply covers "all caught up".
 */
export function ChatReviewList({
  view,
  isNew = false,
}: {
  view: Extract<AssistantToolView, { kind: "suggested_memory_review_list" }>;
  isNew?: boolean;
}) {
  if (view.reviews.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {view.reviews.map((item) => (
        <ChatReviewCard isNew={isNew} item={item} key={item.memoryId} />
      ))}
    </div>
  );
}

const OUTCOME_TONE: Record<Outcome, CardTone> = {
  pending: "tentative",
  saved: "confirmed",
  dismissed: "neutral",
};

/**
 * Interactive version of the chat "Ready to review" card. A suggested memory is
 * tentative until the user acts; this lets them approve or dismiss it inline,
 * through the same owner-scoped review mutations the dashboard and person ledger
 * use (ADR 0026), so they don't have to leave the conversation. The full review
 * (edit wording, sensitivity, archive) still lives on the person's ledger. Routed
 * from the assistant panel rather than the presentational tool-result module so
 * its `server-only`-backed actions stay out of that module's render tests.
 */
export function ChatReviewCard({
  item,
  isNew = false,
}: {
  item: SuggestedReviewItemView;
  isNew?: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const personName = item.personName ?? null;
  const personHref = item.personId ? `/people/${item.personId}#needs-review` : null;

  function act(next: Exclude<Outcome, "pending">, run: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await run();
        setOutcome(next);
      } catch {
        setError("That didn't go through. You can review it on the person's page.");
      }
    });
  }

  return (
    <ResultCard
      footer={<ReviewFooter outcome={outcome} personHref={personHref} personName={personName} />}
      isNew={isNew}
      kind="suggested_memory_review"
      tone={OUTCOME_TONE[outcome]}
    >
      <ReviewChip outcome={outcome} />
      <Body>
        <span className="text-muted-foreground">
          {outcome === "saved" ? "Saved" : outcome === "dismissed" ? "Dismissed" : "Suggested"}
          {personName ? ` for ${personName}` : ""}:{" "}
        </span>
        {item.content}
      </Body>

      {outcome === "pending" ? (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            aria-label={personName ? `Dismiss suggestion for ${personName}` : "Dismiss suggestion"}
            disabled={busy}
            onClick={() =>
              act("dismissed", () => dismissSuggestedMemoryAction({ memoryId: item.memoryId }))
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
            Dismiss
          </Button>
          <Button
            aria-label={personName ? `Approve suggestion for ${personName}` : "Approve suggestion"}
            disabled={busy}
            onClick={() =>
              act("saved", () => saveSuggestedMemoryAction({ memoryId: item.memoryId }))
            }
            size="sm"
            type="button"
          >
            <CheckIcon />
            Approve
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </ResultCard>
  );
}

function ReviewChip({ outcome }: { outcome: Outcome }) {
  if (outcome === "saved") {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-primary">
        <CheckIcon aria-hidden className="size-3" />
        Saved to memory
      </span>
    );
  }

  if (outcome === "dismissed") {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-muted-foreground">
        Dismissed
      </span>
    );
  }

  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      Ready to review
    </span>
  );
}

function ReviewFooter({
  outcome,
  personName,
  personHref,
}: {
  outcome: Outcome;
  personName: string | null;
  personHref: string | null;
}) {
  if (outcome === "saved") {
    return (
      <Caption>
        Confirmed fact{personName ? ` · ${personName}` : ""} — kept in your notebook
      </Caption>
    );
  }

  if (outcome === "dismissed") {
    return <Caption>Dismissed — not kept. Nothing was saved.</Caption>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <Caption>Tentative — not saved until you approve it</Caption>
      {personHref ? (
        <Link
          className="inline-flex items-center gap-0.5 text-[length:var(--text-caption)] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          href={personHref}
        >
          Open{personName ? ` ${personName}` : ""}
          <ArrowUpRightIcon aria-hidden className="size-3" />
        </Link>
      ) : null}
    </div>
  );
}
