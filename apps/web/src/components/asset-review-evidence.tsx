"use client";

import { useState } from "react";
import { removeAssetEvidenceAction } from "@/app/actions/asset-evidence";
import { AssetEvidenceCapture } from "@/components/asset-evidence-capture";
import { AssetEvidenceRow } from "@/components/asset-evidence-shared";
import { GENERIC_ERROR } from "@/components/general-action-shared";
import { PaperclipIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { AssetEvidenceView } from "@/lib/asset-evidence-view";
import type { AssetReviewGroupView } from "@/lib/asset-review-view";
import { usePendingMutationSubmit } from "@/lib/reversible-mutation";
import { useArmedConfirm } from "@/lib/use-armed-confirm";

/**
 * The review card's evidence strip (#200): what has been captured for this group
 * so far, plus the shared capture flow behind one quiet affordance — so a
 * receipt can land on a suggestion *before* the destination Asset is accepted,
 * and the group is reviewed with its grounding in view. Evidence is the owner's
 * deliberate capture, not a pending proposal: it never counts toward the
 * group's pending members and rides the group to wherever review resolves it.
 */
export function AssetReviewEvidenceBlock({
  review,
  disabled,
  onEvidenceChange,
}: {
  review: AssetReviewGroupView;
  disabled: boolean;
  onEvidenceChange: (evidence: AssetEvidenceView[]) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removal = usePendingMutationSubmit(GENERIC_ERROR);

  function removeEvidence(view: AssetEvidenceView) {
    setRemovingId(view.id);
    removal.submit(
      () => removeAssetEvidenceAction({ evidenceId: view.id }),
      () => {
        setRemovingId(null);
        onEvidenceChange(review.evidence.filter((entry) => entry.id !== view.id));
      },
    );
  }

  // Rows, not a framed list: the review card is already the surface, and a
  // bordered box inside a bordered card is banned (DESIGN.md §6).
  return (
    <div className="flex flex-col gap-2">
      {review.evidence.length > 0 ? (
        <ul className="flex flex-col divide-y divide-accent/15">
          {review.evidence.map((view) => (
            <li key={view.id}>
              <AssetEvidenceRow
                onRemove={disabled ? undefined : () => removeEvidence(view)}
                removing={removingId === view.id}
                showPrivateBadge={review.asset.scope !== "private" && view.scope === "private"}
                view={view}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {removal.error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {removal.error}
        </p>
      ) : null}

      {capturing ? (
        <AssetEvidenceCapture
          assetScope={review.asset.scope}
          onAdded={(view) => {
            setCapturing(false);
            onEvidenceChange([...review.evidence, view]);
          }}
          onCancel={() => setCapturing(false)}
          target={{ reviewGroupId: review.groupId }}
        />
      ) : (
        <Button
          className="w-fit"
          disabled={disabled}
          onClick={() => setCapturing(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PaperclipIcon />
          Attach evidence
        </Button>
      )}
    </div>
  );
}

/**
 * The group's dismiss affordance, evidence-aware (#196, #200): dismissing a
 * pending Suggested Asset deletes the evidence captured for it (rows and stored
 * bytes — no invisible bucket may survive a rejected proposal), so when that is
 * about to happen the button turns into an explicit two-step confirm that says
 * so. A group without at-risk evidence dismisses in one calm click, and a
 * durable-anchor group's evidence is never at risk — it stays on its real asset.
 */
export function DismissGroupButton({
  batchable,
  evidenceAtRisk,
  disabled,
  onDismiss,
}: {
  batchable: boolean;
  /** How many attachments a dismiss would delete; 0 keeps the single step. */
  evidenceAtRisk: number;
  disabled: boolean;
  onDismiss: () => void;
}) {
  const confirm = useArmedConfirm();
  const label = batchable ? "Dismiss all" : "Dismiss";

  if (evidenceAtRisk > 0 && confirm.confirming) {
    return (
      <Button
        disabled={disabled || !confirm.armed}
        onBlur={confirm.cancel}
        onClick={onDismiss}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            confirm.cancel();
          }
        }}
        size="sm"
        type="button"
        variant="destructive"
      >
        <XIcon />
        {`${label} and delete ${evidenceAtRisk} ${evidenceAtRisk === 1 ? "attachment" : "attachments"}?`}
      </Button>
    );
  }

  return (
    <Button
      disabled={disabled}
      onClick={evidenceAtRisk > 0 ? confirm.begin : onDismiss}
      size="sm"
      type="button"
      variant="ghost"
    >
      <XIcon />
      {label}
    </Button>
  );
}
