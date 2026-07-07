"use client";

import { ArrowUpRightIcon, CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Body, Caption, type CardTone, ResultCard } from "@/components/assistant-result-card";
import { Button } from "@/components/ui/button";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";

/**
 * pending — tentative, the user has not acted yet.
 * resolved — the positive action ran (approved / accepted / saved).
 * dismissed — the user dismissed it.
 */
type ReviewOutcome = "pending" | "resolved" | "dismissed";

/**
 * The per-kind copy for one inline review card. Everything else — the state
 * machine, layout, tone, chips, action row, error handling, and the person link —
 * is shared, so a suggested memory, a suggested follow-up, and a logged note that
 * can be promoted all read as one vocabulary (DESIGN.md §6, ADR 0026).
 */
export type ReviewActionLabels = {
  /** Lead word in the body line while pending, e.g. "Suggested". */
  pendingWord: string;
  /** Lead word once resolved, e.g. "Saved" / "Accepted". */
  resolvedWord: string;
  /** Confirmed chip text once resolved, e.g. "Saved to memory". */
  resolvedChip: string;
  /** Primary action button text, e.g. "Approve" / "Accept" / "Save as memory". */
  primaryAction: string;
  /** Noun used in the action aria-labels, e.g. "suggestion" / "logged note". */
  noun: string;
  /** Footer caption while pending, e.g. "Tentative — not saved until you approve it". */
  pendingFooter: string;
  /** Footer caption once resolved (already includes the person, if any). */
  resolvedFooter: string;
  /** Footer caption once dismissed. */
  dismissedFooter: string;
  /**
   * Where the item can still be reviewed if the inline action fails, phrased as a full
   * sentence appended to the error, e.g. "You can review it on the person's page." A
   * follow-up/memory recovers on the person's page; a General Action, on /actions.
   */
  errorRecovery: string;
  /**
   * Optional override for the pending footer's "Open" link text. Defaults to
   * "Open{ personName}" so a person-scoped card reads "Open Mark"; a card whose subject
   * is not a person (a General Action) sets this to name its destination, e.g.
   * "Open in Actions".
   */
  openLabel?: string;
};

const OUTCOME_TONE: Record<Exclude<ReviewOutcome, "pending">, CardTone> = {
  resolved: "confirmed",
  dismissed: "neutral",
};

/** An action button's aria-label, naming the person when the card has one. */
function actionAriaLabel(verb: string, noun: string, personName: string | null): string {
  return personName ? `${verb} ${noun} for ${personName}` : `${verb} ${noun}`;
}

/** The body's lead word for the card's current outcome. */
function reviewLeadWord(outcome: ReviewOutcome, labels: ReviewActionLabels): string {
  if (outcome === "resolved") return labels.resolvedWord;
  if (outcome === "dismissed") return "Dismissed";
  return labels.pendingWord;
}

/**
 * The one interactive review card behind every in-chat "act on it now" surface. A
 * tentative item (suggested memory, suggested follow-up) or a logged note the user
 * can promote stays actionable inline: the user resolves or dismisses it through the
 * same owner-scoped mutations the dashboard and person ledger use (ADR 0026), without
 * leaving the conversation. On action it settles in place — resolve flips it to the
 * confirmed (sage) treatment, dismiss settles it to quiet neutral. The full edit
 * (wording, sensitivity, timing, archive) still lives on the person's ledger, which
 * the card links to.
 */
export function ChatReviewActionCard({
  kind,
  isNew = false,
  personName,
  personHref,
  content,
  meta,
  labels,
  onResolve,
  onDismiss,
  pendingTone = "tentative",
  pendingChipLabel = "Ready to review",
}: {
  kind: AssistantToolView["kind"];
  isNew?: boolean;
  personName: string | null;
  personHref: string | null;
  content: React.ReactNode;
  /** Optional extra caption under the body, e.g. a follow-up's proposed date. */
  meta?: React.ReactNode;
  labels: ReviewActionLabels;
  onResolve: () => Promise<unknown>;
  onDismiss: () => Promise<unknown>;
  /** Resting tone before the user acts — clay for suggestions, neutral for logged notes. */
  pendingTone?: Extract<CardTone, "tentative" | "neutral">;
  /** Pending chip text, e.g. "Ready to review" / "Logged". */
  pendingChipLabel?: string;
}) {
  const [outcome, setOutcome] = useState<ReviewOutcome>("pending");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function act(next: Exclude<ReviewOutcome, "pending">, run: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await run();
        setOutcome(next);
      } catch {
        setError(`That didn't go through. ${labels.errorRecovery}`);
      }
    });
  }

  const tone: CardTone = outcome === "pending" ? pendingTone : OUTCOME_TONE[outcome];
  const leadWord = reviewLeadWord(outcome, labels);

  return (
    <ResultCard
      footer={
        <ReviewFooter
          labels={labels}
          outcome={outcome}
          personHref={personHref}
          personName={personName}
        />
      }
      isNew={isNew}
      kind={kind}
      tone={tone}
    >
      <ReviewChip
        outcome={outcome}
        pendingLabel={pendingChipLabel}
        pendingTone={pendingTone}
        resolvedChip={labels.resolvedChip}
      />
      <Body>
        <span className="text-muted-foreground">
          {leadWord}
          {personName ? ` for ${personName}` : ""}:{" "}
        </span>
        {content}
      </Body>
      {meta ? <Caption>{meta}</Caption> : null}

      {outcome === "pending" ? (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            aria-label={actionAriaLabel("Dismiss", labels.noun, personName)}
            disabled={busy}
            onClick={() => act("dismissed", onDismiss)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
            Dismiss
          </Button>
          <Button
            aria-label={actionAriaLabel(labels.primaryAction, labels.noun, personName)}
            disabled={busy}
            onClick={() => act("resolved", onResolve)}
            size="sm"
            type="button"
          >
            <CheckIcon />
            {labels.primaryAction}
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

function ReviewChip({
  outcome,
  resolvedChip,
  pendingLabel,
  pendingTone,
}: {
  outcome: ReviewOutcome;
  resolvedChip: string;
  pendingLabel: string;
  pendingTone: Extract<CardTone, "tentative" | "neutral">;
}) {
  if (outcome === "resolved") {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-primary">
        <CheckIcon aria-hidden className="size-3" />
        {resolvedChip}
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

  // Pending: clay for tentative suggestions, neutral for logged context (DESIGN.md §3).
  if (pendingTone === "neutral") {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60" />
        {pendingLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {pendingLabel}
    </span>
  );
}

function ReviewFooter({
  outcome,
  labels,
  personName,
  personHref,
}: {
  outcome: ReviewOutcome;
  labels: ReviewActionLabels;
  personName: string | null;
  personHref: string | null;
}) {
  if (outcome === "resolved") {
    return <Caption>{labels.resolvedFooter}</Caption>;
  }

  if (outcome === "dismissed") {
    return <Caption>{labels.dismissedFooter}</Caption>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <Caption>{labels.pendingFooter}</Caption>
      {personHref ? (
        <Link
          className="inline-flex items-center gap-0.5 text-[length:var(--text-caption)] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          href={personHref}
        >
          {labels.openLabel ?? `Open${personName ? ` ${personName}` : ""}`}
          <ArrowUpRightIcon aria-hidden className="size-3" />
        </Link>
      ) : null}
    </div>
  );
}
