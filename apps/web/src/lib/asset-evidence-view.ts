import type {
  AssetChildScope,
  AssetEvidence,
  AssetEvidenceKind,
  AssetOwnership,
} from "@tendnote/domain";
import { assetEvidenceLabelForKind, isAssetEvidenceImage } from "@tendnote/domain";
import { formatSurfacingDay } from "@tendnote/domain/record-surfacing";
import { formatAssetMemoryValue } from "./asset-memory-value";
import type { OwnerActionResult } from "./owner-action";

/**
 * Result of an Asset Evidence mutation server action: the same result union the
 * Asset and Action families use, so validation failures render inline and infra
 * failures fall back generically.
 */
export type AssetEvidenceMutationResult = OwnerActionResult<AssetEvidenceView>;

/**
 * Serializable, fixed-shape view of one piece of Asset Evidence (#200) — what
 * the Asset Profile evidence list and the review card's evidence strip render.
 * File bytes never ride a view: `fileHref` points at the gated file route, which
 * re-checks visibility on every request.
 */
export type AssetEvidenceView = {
  id: string;
  kind: AssetEvidenceKind;
  kindLabel: string;
  label: string;
  /** Whether stored bytes exist behind the gated file route. */
  hasFile: boolean;
  fileName: string | null;
  /** Whether the file renders inline as an image (thumbnail/preview). */
  isImage: boolean;
  /** The gated file route for preview/download, or null without a file. */
  fileHref: string | null;
  /** Readable size ("47 KB"), or null without a file. */
  sizeLabel: string | null;
  url: string | null;
  capturedText: string | null;
  /** "$42.99" when money metadata rides the evidence. */
  moneyLabel: string | null;
  /** "Mar 14, 2026" purchase/renewal anchors, day-precise. */
  purchasedOnLabel: string | null;
  renewsOnLabel: string | null;
  /** Per-record visibility under the child-scope ceiling. */
  scope: AssetChildScope;
  /** Whether the viewing user owns this evidence. */
  owned: boolean;
  ownership: AssetOwnership;
  /**
   * Whether this viewer may remove it: their own always, the household's own as
   * any active member. No member may ever delete another member's evidence,
   * however wide its audience (ADR 0214).
   */
  canRemove: boolean;
  /** A calm provenance line, e.g. "Added Jul 1". */
  addedLabel: string;
};

/**
 * Readable byte size ("779 B", "47 KB", "1.2 MB") — shared by the evidence list
 * and the capture form's picked-file strip so sizes never read two ways.
 */
export function formatEvidenceSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A day-precise date label via the shared value codec, so days never shift. */
function dayLabel(date: string | null, now: Date): string | null {
  return date === null ? null : formatAssetMemoryValue({ type: "date", date }, now);
}

/** Maps one evidence record to the flat view capture and profile surfaces render. */
export function toAssetEvidenceView(
  record: AssetEvidence,
  options: { callerUserId: string; now?: Date },
): AssetEvidenceView {
  const now = options.now ?? new Date();
  const hasFile = record.fileName !== null;
  return {
    id: record.id,
    kind: record.kind,
    kindLabel: assetEvidenceLabelForKind(record.kind),
    label: record.label,
    hasFile,
    fileName: record.fileName,
    isImage: isAssetEvidenceImage(record.mimeType),
    fileHref: hasFile ? `/api/asset-evidence/${record.id}/file` : null,
    sizeLabel: record.sizeBytes !== null ? formatEvidenceSize(record.sizeBytes) : null,
    url: record.url,
    capturedText: record.capturedText,
    moneyLabel:
      record.money !== null
        ? formatAssetMemoryValue({
            type: "amount",
            amount: record.money.amount,
            currency: record.money.currency,
          })
        : null,
    purchasedOnLabel: dayLabel(record.purchasedOn, now),
    renewsOnLabel: dayLabel(record.renewsOn, now),
    scope: record.scope,
    owned: record.ownerUserId === options.callerUserId,
    ownership: record.ownership,
    canRemove:
      record.ownership === "household_native" || record.ownerUserId === options.callerUserId,
    addedLabel: `Added ${formatSurfacingDay(record.createdAt, now)}`,
  };
}
