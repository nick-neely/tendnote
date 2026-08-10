"use client";

import type { AssetOwnership, PrivacyScope } from "@tendnote/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { removeAssetEvidenceAction } from "@/app/actions/asset-evidence";
import { AssetEvidenceCapture } from "@/components/asset-evidence-capture";
import { AssetEvidenceRow } from "@/components/asset-evidence-shared";
import { GENERIC_ERROR } from "@/components/general-action-shared";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { LedgerList } from "@/components/person-ledger";
import { EmptyState } from "@/components/ui/empty-state";
import type { AssetEvidenceView } from "@/lib/asset-evidence-view";
import { usePendingMutationSubmit } from "@/lib/reversible-mutation";

/**
 * The Asset Profile's evidence surface (#200): the caller-visible evidence at
 * Personal Ledger density, with the shared capture flow right underneath — drop
 * zone on desktop, camera entry on mobile, link/note one step away. The list is
 * optimistic against the server-rendered initial views; every write still lands
 * through the owner-scoped seam and refreshes the page as the source of truth.
 */
export function AssetEvidenceSection({
  assetId,
  assetOwnership = "member_owned",
  assetScope,
  initialEvidence,
  canCapture,
  shareableMembers = [],
}: {
  assetId: string;
  /** The anchor's ownership form; see {@link AssetEvidenceCapture}. */
  assetOwnership?: AssetOwnership;
  assetScope: PrivacyScope;
  initialEvidence: AssetEvidenceView[];
  /** Capture is for the asset's owner while it is active; viewers just read. */
  canCapture: boolean;
  shareableMembers?: ShareableActionMember[];
}) {
  const router = useRouter();
  const [evidence, setEvidence] = useState(initialEvidence);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removal = usePendingMutationSubmit(GENERIC_ERROR);

  function removeEvidence(view: AssetEvidenceView) {
    setRemovingId(view.id);
    removal.submit(
      () => removeAssetEvidenceAction({ evidenceId: view.id }),
      () => {
        setEvidence((current) => current.filter((entry) => entry.id !== view.id));
        setRemovingId(null);
        router.refresh();
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {evidence.length > 0 ? (
        <LedgerList>
          {evidence.map((view) => (
            <AssetEvidenceRow
              key={view.id}
              onRemove={view.canRemove && canCapture ? () => removeEvidence(view) : undefined}
              removing={removingId === view.id}
              showPrivateBadge={assetScope !== "private" && view.scope === "private"}
              view={view}
            />
          ))}
        </LedgerList>
      ) : canCapture ? null : ( // The capture zone below already says "nothing here yet" better.
        <EmptyState size="compact" title="No receipts, manuals, or photos attached yet." />
      )}

      {removal.error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {removal.error}
        </p>
      ) : null}

      {canCapture ? (
        <AssetEvidenceCapture
          assetOwnership={assetOwnership}
          assetScope={assetScope}
          onAdded={(view) => {
            setEvidence((current) => [...current, view]);
            router.refresh();
          }}
          shareableMembers={shareableMembers}
          target={{ assetId }}
        />
      ) : null}
    </div>
  );
}
