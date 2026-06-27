"use client";

import { ArrowUpRightIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  acceptSuggestedFollowupAction,
  dismissSuggestedFollowupAction,
} from "@/app/actions/suggested-followups";
import { Body, Caption, type CardTone, ResultCard } from "@/components/assistant-tool-result";
import { Button } from "@/components/ui/button";
import type {
  AssistantToolView,
  SuggestedFollowupReviewItemView,
} from "@/lib/eve/tool-result-view";

type Outcome = "pending" | "accepted" | "dismissed";

/**
 * Renders the interactive cards for a `list_suggested_followup_reviews` result —
 * every open suggested follow-up returned in one call. Empty resolves to nothing;
 * the assistant's own reply covers "nothing to review".
 */
export function ChatFollowupReviewList({
  view,
  isNew = false,
}: {
  view: Extract<AssistantToolView, { kind: "suggested_followup_review_list" }>;
  isNew?: boolean;
}) {
  if (view.reviews.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {view.reviews.map((item) => (
        <ChatFollowupReviewCard isNew={isNew} item={item} key={item.followupId} />
      ))}
    </div>
  );
}

const OUTCOME_TONE: Record<Outcome, CardTone> = {
  pending: "tentative",
  accepted: "confirmed",
  dismissed: "neutral",
};

/**
 * Interactive in-chat review for a suggested follow-up. It is tentative until the
 * user acts; this lets them accept it (promoting it to an active reminder) or
 * dismiss it inline through the same owner-scoped review mutations the dashboard
 * and person ledger use, without leaving the conversation. Editing the timing
 * before accepting lives on the person's ledger.
 */
export function ChatFollowupReviewCard({
  item,
  isNew = false,
}: {
  item: SuggestedFollowupReviewItemView;
  isNew?: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const personName = item.personName ?? null;
  const personHref = item.personId ? `/people/${item.personId}#follow-ups` : null;

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
      kind="suggested_followup_review"
      tone={OUTCOME_TONE[outcome]}
    >
      <ReviewChip outcome={outcome} />
      <Body>
        <span className="text-muted-foreground">
          {outcome === "accepted"
            ? "Accepted"
            : outcome === "dismissed"
              ? "Dismissed"
              : "Suggested follow-up"}
          {personName ? ` for ${personName}` : ""}:{" "}
        </span>
        {item.reason}
      </Body>
      <Caption>Proposed for {item.dueLabel}</Caption>

      {outcome === "pending" ? (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            aria-label={
              personName ? `Dismiss suggested follow-up for ${personName}` : "Dismiss suggestion"
            }
            disabled={busy}
            onClick={() =>
              act("dismissed", () =>
                dismissSuggestedFollowupAction({ followupId: item.followupId }),
              )
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
            Dismiss
          </Button>
          <Button
            aria-label={
              personName ? `Accept suggested follow-up for ${personName}` : "Accept suggestion"
            }
            disabled={busy}
            onClick={() =>
              act("accepted", () => acceptSuggestedFollowupAction({ followupId: item.followupId }))
            }
            size="sm"
            type="button"
          >
            <CheckIcon />
            Accept
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
  if (outcome === "accepted") {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-primary">
        <CheckIcon aria-hidden className="size-3" />
        Reminder set
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
  if (outcome === "accepted") {
    return (
      <Caption>
        Active reminder{personName ? ` · ${personName}` : ""} — added to your follow-ups
      </Caption>
    );
  }

  if (outcome === "dismissed") {
    return <Caption>Dismissed — not kept. No reminder was created.</Caption>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <Caption>Tentative — no reminder until you accept it</Caption>
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
