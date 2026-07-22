"use client";

import { CalendarRangeIcon, CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { proposeAssetMemoryActionsAction } from "@/app/actions/asset-action-proposals";
import {
  acceptSuggestedGeneralActionAction,
  ignoreSuggestedGeneralActionAction,
} from "@/app/actions/suggested-general-actions";
import { ActionRoutineChip, ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  type AssetActionProposalSummary,
  describeProposalOutcome,
  type PendingAssetActionProposalView,
} from "@/lib/asset-action-proposal-view";

/**
 * The Asset Profile's reminder proposals (#203): the owner asks this asset's reviewed
 * details to suggest General Actions, and reviews what comes back — right here, inline.
 *
 * Two deliberate restraints. Proposing is a *button*, never automatic: Tendnote does not
 * scan your fridge and hand you homework, it answers when asked (#196 — proactive asset
 * behavior stays capped and explainable, with no background scanner). And review is the
 * existing Suggested General Action path, called straight through — accept promotes the
 * same row in place onto the Actions ledger, set-aside quietly clears it. There is no
 * asset-side lifecycle here, because there is only ever one lifecycle.
 *
 * It also speaks the profile's *one* review language. A page cannot have two vocabularies
 * for "Tendnote thinks this — do you agree?" two hundred pixels apart, so proposals wear
 * the same clay strip, the same dot badge, and the same two named verbs as the suggested
 * links above them (#202). Clay is the repo's reserved review-needed color (DESIGN.md §3):
 * what Tendnote guesses never reads at the weight of what the owner has confirmed.
 */
export function AssetActionProposals({
  assetId,
  canPropose,
  proposals,
}: {
  assetId: string;
  /** Proposing is owner-only and pointless on an archived asset. */
  canPropose: boolean;
  proposals: PendingAssetActionProposalView[];
}) {
  // Resolving a proposal takes its buttons out of the document; the section catches
  // focus so a keyboard user is never dropped back to <body>, and the live region says
  // what happened — a row vanishing in silence is not feedback.
  const sectionRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");

  function resolved(message: string): void {
    setAnnouncement(message);
    sectionRef.current?.focus();
  }

  if (!canPropose && proposals.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      ref={sectionRef}
      tabIndex={-1}
    >
      {proposals.length > 0 ? (
        <SuggestedReminders onResolved={resolved} proposals={proposals} />
      ) : null}
      {canPropose ? <ProposeControl assetId={assetId} onOutcome={setAnnouncement} /> : null}
      {/* Named, because the pending spinner is also a `status` region: without a name the
          two are indistinguishable to anything querying by role, including tests. */}
      <p aria-atomic aria-label="Reminder proposals" className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}

/**
 * The pending proposals, held apart from the durable ledger below and marked in clay —
 * the one color reserved for review-needed state. Nothing here is on the owner's list
 * until they say so, and the copy says exactly that.
 */
function SuggestedReminders({
  proposals,
  onResolved,
}: {
  proposals: PendingAssetActionProposalView[];
  onResolved: (message: string) => void;
}) {
  return (
    <section
      aria-label="Suggested reminders"
      className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent-soft/45 px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          Suggested
        </span>
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          Nothing lands on your actions until you say so.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-accent/20">
        {proposals.map((proposal) => (
          <li
            className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0"
            key={proposal.generalActionId}
          >
            <ProposalRow onResolved={onResolved} proposal={proposal} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One proposed reminder: what it is, when it would land, and the detail that argued for it. */
function ProposalRow({
  proposal,
  onResolved,
}: {
  proposal: PendingAssetActionProposalView;
  onResolved: (message: string) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(mutate: () => Promise<unknown>, announcement: string): void {
    setError(null);
    startTransition(async () => {
      try {
        await mutate();
        onResolved(announcement);
        router.refresh();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {proposal.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            {proposal.timingLabel}
          </span>
          {proposal.recurrenceLabel ? <ActionRoutineChip label={proposal.recurrenceLabel} /> : null}
        </span>
        {/* The whole reason the owner can judge this fairly. */}
        <span className="text-[length:var(--text-caption)] text-muted-foreground">
          From “{proposal.memoryLabel}”
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () =>
                acceptSuggestedGeneralActionAction({ generalActionId: proposal.generalActionId }),
              `Added “${proposal.title}” to your actions.`,
            )
          }
          size="sm"
          type="button"
          variant="outline"
        >
          {pending ? <Spinner /> : <CheckIcon />}
          Add reminder
        </Button>
        {/* Set aside is `ignore`, not `dismiss`, and that is the recoverable choice
            here: an ignored proposal leaves no resolved-trail residue, and the memory
            that argued for it can propose again — so a misclick on a row the owner
            barely read costs them nothing. Dismissal is the deliberate, sticking
            rejection, and it lives in the Review Queue where that weight belongs. */}
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () =>
                ignoreSuggestedGeneralActionAction({ generalActionId: proposal.generalActionId }),
              `Set aside “${proposal.title}”.`,
            )
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          Set aside
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </>
  );
}

/**
 * The ask. Deliberately a quiet, low-commitment control — and an honest one: a pass that
 * finds nothing says *which* nothing it found (`describeProposalOutcome`), because
 * "these already have reminders" is a comfortable sentence that turns into a lie the
 * moment the owner has turned a proposal down.
 */
function ProposeControl({
  assetId,
  onOutcome,
}: {
  assetId: string;
  onOutcome: (message: string) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function settle(summary: AssetActionProposalSummary): void {
    const message = describeProposalOutcome(summary);
    // An empty pass says so where the user is looking, and the paragraph announces
    // itself — one message, not a visible copy plus a screen-reader echo.
    if (message) {
      setOutcome(message);
      return;
    }
    // A productive pass has no message: the rows *are* the result. They arrive on a
    // server refresh, though, so the live region is the only thing that can tell a
    // screen-reader user that anything happened at all.
    onOutcome(
      summary.proposed === 1
        ? "1 reminder suggested. Review it below."
        : `${summary.proposed} reminders suggested. Review them below.`,
    );
    router.refresh();
  }

  function propose(): void {
    setError(null);
    setOutcome(null);
    startTransition(async () => {
      try {
        const result = await proposeAssetMemoryActionsAction({ assetId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        settle(result.view);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        className="w-fit"
        disabled={pending}
        onClick={propose}
        size="sm"
        type="button"
        variant="outline"
      >
        {pending ? <Spinner /> : <CalendarRangeIcon aria-hidden className="size-4" />}
        Suggest reminders from details
      </Button>
      {outcome ? (
        <p
          className="max-w-[68ch] text-[length:var(--text-caption)] text-muted-foreground"
          role="status"
        >
          {outcome}
        </p>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}
