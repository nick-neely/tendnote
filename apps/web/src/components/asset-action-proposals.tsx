"use client";

import { CheckIcon, SparklesIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { proposeAssetMemoryActionsAction } from "@/app/actions/asset-action-proposals";
import {
  acceptSuggestedGeneralActionAction,
  ignoreSuggestedGeneralActionAction,
} from "@/app/actions/suggested-general-actions";
import { ActionRoutineChip, ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { PendingAssetActionProposalView } from "@/lib/asset-action-proposal-view";

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
 * Each proposal names the detail it was read from, so "Replace Refrigerator water filter"
 * arrives with its reasoning attached rather than as a reminder from nowhere.
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
  if (!canPropose && proposals.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {proposals.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border border-dashed">
          {proposals.map((proposal) => (
            <ProposalRow key={proposal.generalActionId} proposal={proposal} />
          ))}
        </ul>
      ) : null}
      {canPropose ? <ProposeControl assetId={assetId} /> : null}
    </div>
  );
}

/**
 * One proposed reminder, awaiting the owner's word. Dashed border and a "Suggested" cue
 * — state by shape and text, never color alone — so it reads as tentative beside the
 * durable related actions below it, and can never be mistaken for something already on
 * the ledger.
 */
function ProposalRow({ proposal }: { proposal: PendingAssetActionProposalView }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(mutate: () => Promise<unknown>): void {
    setError(null);
    startTransition(async () => {
      try {
        await mutate();
        router.refresh();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
            {proposal.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline">Suggested</Badge>
            <span className="text-[length:var(--text-caption)] text-muted-foreground">
              {proposal.timingLabel}
            </span>
            {proposal.recurrenceLabel ? (
              <ActionRoutineChip label={proposal.recurrenceLabel} />
            ) : null}
          </span>
          {/* The whole reason the owner can judge this fairly. */}
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            From “{proposal.memoryLabel}”
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pending ? <Spinner className="size-4" /> : null}
          <Button
            aria-label={`Add “${proposal.title}” to your actions`}
            disabled={pending}
            onClick={() =>
              run(() =>
                acceptSuggestedGeneralActionAction({
                  generalActionId: proposal.generalActionId,
                }),
              )
            }
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <CheckIcon aria-hidden className="size-4" />
          </Button>
          {/* Set aside is `ignore`, not `dismiss`, and that is the recoverable choice
              here: an ignored proposal leaves no resolved-trail residue, and the memory
              that argued for it can propose again — so a misclick on a row the owner
              barely read costs them nothing. Dismissal is the deliberate, sticking
              rejection, and it lives in the Review Queue where that weight belongs. */}
          <Button
            aria-label={`Set aside “${proposal.title}”`}
            disabled={pending}
            onClick={() =>
              run(() =>
                ignoreSuggestedGeneralActionAction({
                  generalActionId: proposal.generalActionId,
                }),
              )
            }
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </li>
  );
}

/**
 * The ask. Deliberately a quiet, low-commitment control: a pass that finds nothing new
 * says so plainly rather than treating an empty result as a failure — every dated detail
 * already having a reminder is the *good* outcome, not an error state.
 */
function ProposeControl({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        if (result.view.proposed === 0) {
          setOutcome("Nothing new to suggest — the dated details here already have reminders.");
          return;
        }
        router.refresh();
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
        {pending ? <Spinner className="size-4" /> : <SparklesIcon aria-hidden className="size-4" />}
        Suggest reminders from details
      </Button>
      {outcome ? (
        <p className="text-[length:var(--text-caption)] text-muted-foreground">{outcome}</p>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}
