"use client";

import { assetHintLabelsMatch } from "@tendnote/domain/general-action-asset-links";
import { PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { promoteAssetHintAction } from "@/app/actions/general-actions";
import {
  ActionContextChip,
  ActionLinkedAssetChip,
  ActionPendingAssetChip,
  ActionRoutineChip,
  ActionScopeChip,
  ErrorText,
  GENERIC_ERROR,
} from "@/components/general-action-shared";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionView } from "@/lib/general-action-view";

/** The linked Asset a hint became, if any — matched by the hint label it was promoted from. */
function linkedAssetForHint(action: GeneralActionView, label: string) {
  return action.linkedAssets.find(
    (asset) => asset.hintLabel !== null && assetHintLabelsMatch(asset.hintLabel, label),
  );
}

/**
 * One asset hint in the context strip (#199): a plain chip while it's just a
 * label, a quiet "in review" chip while its promotion waits in the queue, and a
 * deep-linking Asset chip once it's real. The owner gets a small "Track" entry
 * point beside an unpromoted hint — promotion is review-gated, so this only
 * opens a proposal, never silently creates a record.
 */
function ActionAssetHintChip({
  action,
  label,
  busy,
  onTrack,
}: {
  action: GeneralActionView;
  label: string;
  busy: boolean;
  onTrack: ((label: string) => void) | null;
}) {
  const linked = linkedAssetForHint(action, label);
  if (linked && !linked.pending) {
    return <ActionLinkedAssetChip asset={linked} />;
  }
  if (linked?.pending) {
    return <ActionPendingAssetChip label={label} />;
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <ActionContextChip kind="asset">{label}</ActionContextChip>
      {onTrack ? (
        <button
          aria-label={`Track "${label}" as an asset`}
          className="inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-[length:var(--text-caption)] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          disabled={busy}
          onClick={() => onTrack(label)}
          title={`Track "${label}" as an asset`}
          type="button"
        >
          {busy ? <Spinner className="size-3" /> : <PlusIcon aria-hidden className="size-3" />}
          Track
        </button>
      ) : null}
    </span>
  );
}

/**
 * The quiet context strip under an Action's title: cadence, scope, linked people,
 * asset hints, and the Assets those hints became (#199). A linked asset that no
 * longer pairs with a hint (the hint was edited away) still shows — the link is
 * the durable record, the hint was only its seed.
 */
export function ActionContextStrip({
  action,
  onUpdate,
}: {
  action: GeneralActionView;
  onUpdate?: (view: GeneralActionView) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyHint, setBusyHint] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Promotion is owner-only, and only on rows that can take an in-place update.
  const canTrack = action.owned && onUpdate !== undefined;

  function track(label: string) {
    setError(null);
    setBusyHint(label);
    startTransition(async () => {
      try {
        const result = await promoteAssetHintAction({
          generalActionId: action.id,
          hintLabel: label,
        });
        if (!result.ok) {
          setError(result.error);
        } else {
          onUpdate?.(result.view);
        }
      } catch {
        setError(GENERIC_ERROR);
      }
      setBusyHint(null);
    });
  }

  const hintlessLinkedAssets = action.linkedAssets.filter(
    (asset) =>
      !asset.pending &&
      (asset.hintLabel === null ||
        !action.assetHints.some((hint) => assetHintLabelsMatch(hint.label, asset.hintLabel ?? ""))),
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {action.recurrenceLabel ? <ActionRoutineChip label={action.recurrenceLabel} /> : null}
        <ActionScopeChip label={action.visibilityLabel} scope={action.scope} />
        {action.linkedPeople.map((person) => (
          <ActionContextChip key={person.id} kind="person">
            {person.displayName}
          </ActionContextChip>
        ))}
        {action.assetHints.map((hint) => (
          <ActionAssetHintChip
            action={action}
            busy={busyHint === hint.label}
            key={hint.label}
            label={hint.label}
            onTrack={canTrack ? track : null}
          />
        ))}
        {hintlessLinkedAssets.map((asset) => (
          <ActionLinkedAssetChip asset={asset} key={asset.assetId} />
        ))}
      </div>
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}
