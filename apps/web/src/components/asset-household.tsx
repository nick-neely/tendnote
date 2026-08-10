import { assetAttributionLabel } from "@tendnote/domain";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { HomeIcon } from "@/components/icons";
import type { AssetView } from "@/lib/asset-view";

/**
 * Who an Asset belongs to, said in one quiet line.
 *
 * Two different sentences, never both: a household-native Asset is the
 * household's, and an Asset someone else owns is theirs and shared with you.
 * Your own Asset says nothing, because "shared by you" is a fact you already
 * have and a ledger row is not the place to repeat it.
 *
 * The wording, the glyph, and the caption weight are deliberately identical to
 * the Actions surface (#383). A household reads one product, not two, and
 * "Household" meaning one thing on a chore and something subtly different on a
 * refrigerator is how a shared workspace stops being legible.
 *
 * Text with one glyph rather than a pill: a badge would read as a status the row
 * is reporting, and this is only attribution.
 */
export function AssetAttributionLine({
  asset,
  members,
}: {
  asset: AssetView;
  members: ShareableActionMember[];
}) {
  // Ownership form first — a household-native Asset's `ownerUserId` is a storage
  // key, and reaching for a name there would credit the household's refrigerator
  // to whoever happened to type it (ADR 0214).
  const attribution = assetAttributionLabel({
    ownership: asset.ownership,
    owned: asset.owned,
    ownerName: members.find((member) => member.userId === asset.ownerUserId)?.name ?? null,
  });
  if (!attribution) {
    return null;
  }
  if (attribution.kind === "household") {
    return (
      <span className="inline-flex w-fit items-center gap-1 text-[length:var(--text-caption)] text-muted-foreground">
        <HomeIcon aria-hidden className="size-3 shrink-0" />
        Household
      </span>
    );
  }
  return (
    <span className="text-[length:var(--text-caption)] text-muted-foreground">
      {attribution.label}
    </span>
  );
}

/**
 * The provenance line on an Asset Profile: who started it and who last touched
 * it.
 *
 * Only on a record more than one person can write, and only when the two are
 * different people — on a private Asset both halves are the viewer, and a
 * notebook does not tell you that you wrote in it. Factual and quiet: never an
 * activity feed, a comment thread, a maintenance log, or a fairness record.
 */
export function AssetProvenanceLine({
  asset,
  members,
  viewerUserId,
}: {
  asset: AssetView;
  members: ShareableActionMember[];
  viewerUserId: string;
}) {
  if (asset.scope === "private") {
    return null;
  }
  const nameFor = (userId: string | null) => {
    if (!userId) return null;
    if (userId === viewerUserId) return "you";
    return members.find((member) => member.userId === userId)?.name ?? null;
  };
  const startedBy = nameFor(asset.createdByUserId);
  const changedBy = nameFor(asset.lastActorUserId);
  const parts = [
    startedBy ? `Added by ${startedBy}` : null,
    // Suppressed when the last actor is also the person who added it: "Added by
    // Ana · Last changed by Ana" is a line that says one thing twice.
    changedBy && changedBy !== startedBy ? `Last changed by ${changedBy}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return null;
  }
  return (
    <p className="text-[length:var(--text-caption)] text-muted-foreground">{parts.join(" · ")}</p>
  );
}
